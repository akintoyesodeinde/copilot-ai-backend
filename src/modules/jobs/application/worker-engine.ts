import os from 'node:os';
import type { Prisma } from '@/generated/prisma/client';
import { getEnv } from '@/config/env';
import { getPrisma } from '@/shared/database/prisma';
import { getLogger } from '@/shared/logging/logger';
import { getJobQueueTransport } from '@/modules/jobs/infrastructure/sqs-queue';
import {
  dispatchPendingOutboxEvents,
  recoverStaleJobs,
} from '@/modules/jobs/application/job-queue.service';
import { executeRepoSyncJob } from '@/modules/github/application/github.service';
import { executeRepoIndexJob } from '@/modules/indexing/application/indexing.service';
import { executePullRequestReviewJob } from '@/modules/reviews/application/review-engine.service';

export type CustomJobHandler = (
  payload: Record<string, unknown>,
  job: {
    id: string;
    workspaceId: string;
    repositoryId: string | null;
  },
) => Promise<Record<string, unknown>>;

const customHandlers = new Map<string, CustomJobHandler>();

export function registerCustomJobHandlerForTesting(
  jobType: string,
  handler: CustomJobHandler | null,
): void {
  if (handler) {
    customHandlers.set(jobType, handler);
  } else {
    customHandlers.delete(jobType);
  }
}

/**
 * Claims and executes a single durable job idempotently, recording attempts,
 * heartbeats, exponential-backoff retries, and dead-letter queue transitions.
 */
export async function processAnalysisJobById(
  jobId: string,
  workerId = `worker-${os.hostname()}-${process.pid}`,
): Promise<{ processed: boolean; status: string }> {
  const prisma = getPrisma();
  const env = getEnv();
  const now = new Date();
  const lockDurationMs = env.WORKER_VISIBILITY_TIMEOUT_SEC * 1000;
  const lockedUntil = new Date(now.getTime() + lockDurationMs);

  // Atomic optimistic claim: prevents duplicate concurrent execution across workers or duplicate SQS deliveries
  const claimed = await prisma.analysisJob.updateMany({
    where: {
      id: jobId,
      status: 'QUEUED',
      nextRunAt: { lte: now },
    },
    data: {
      status: 'RUNNING',
      workerId,
      lockedUntil,
      heartbeatAt: now,
      startedAt: now,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    const existing = await prisma.analysisJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return { processed: false, status: existing?.status ?? 'MISSING' };
  }

  const job = await prisma.analysisJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return { processed: false, status: 'MISSING' };
  }

  const attempt = await prisma.jobAttempt.create({
    data: {
      workspaceId: job.workspaceId,
      jobId: job.id,
      attemptNumber: job.attempts,
      workerId,
      status: 'RUNNING',
      startedAt: now,
    },
  });

  const heartbeatInterval = setInterval(
    () => {
      const beat = new Date();
      void prisma.analysisJob
        .update({
          where: { id: job.id },
          data: {
            heartbeatAt: beat,
            lockedUntil: new Date(beat.getTime() + lockDurationMs),
          },
        })
        .catch(() => undefined);
    },
    Math.max(5_000, Math.floor(lockDurationMs / 3)),
  );
  heartbeatInterval.unref();

  const startMs = Date.now();
  try {
    const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
    let result: Record<string, unknown>;

    const custom = customHandlers.get(job.jobType);
    if (custom) {
      result = await custom(payload, {
        id: job.id,
        workspaceId: job.workspaceId,
        repositoryId: job.repositoryId,
      });
    } else if (job.jobType === 'REPO_SYNC') {
      result = await executeRepoSyncJob(job.workspaceId, String(payload.repositoryId));
    } else if (job.jobType === 'REPO_INDEX') {
      result = await executeRepoIndexJob(
        job.workspaceId,
        String(payload.repositoryId),
        payload.commitSha ? String(payload.commitSha) : undefined,
      );
    } else if (job.jobType === 'PR_REVIEW') {
      result = await executePullRequestReviewJob({
        workspaceId: job.workspaceId,
        repositoryId: String(payload.repositoryId),
        pullRequestId: String(payload.pullRequestId),
        headSha: String(payload.headSha),
        policyVersion: String(payload.policyVersion ?? 'v1'),
        analysisJobId: job.id,
      });
    } else {
      throw new Error(`Unsupported job type: ${job.jobType}`);
    }

    const finishedAt = new Date();
    await prisma.$transaction([
      prisma.jobAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt,
          durationMs: Date.now() - startMs,
        },
      }),
      prisma.analysisJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          resultJson: result as Prisma.InputJsonValue,
          completedAt: finishedAt,
          lockedUntil: null,
          lastError: null,
        },
      }),
    ]);

    return { processed: true, status: 'COMPLETED' };
  } catch (error) {
    const finishedAt = new Date();
    const errMsg = error instanceof Error ? error.message : 'Unknown worker error';
    const errCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'WORKER_ERROR';
    const exhausted = job.attempts >= job.maxAttempts;
    const backoffMs = Math.min(300_000, 1000 * 2 ** job.attempts);
    const nextStatus = exhausted ? 'DEAD_LETTERED' : 'QUEUED';

    await prisma.$transaction([
      prisma.jobAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          errorCode: errCode.slice(0, 64),
          errorMessage: errMsg.slice(0, 2000),
          finishedAt,
          durationMs: Date.now() - startMs,
        },
      }),
      prisma.analysisJob.update({
        where: { id: job.id },
        data: {
          status: nextStatus,
          workerId: null,
          lockedUntil: null,
          nextRunAt: exhausted ? finishedAt : new Date(Date.now() + backoffMs),
          lastError: errMsg.slice(0, 2000),
        },
      }),
    ]);

    if (exhausted) {
      await getJobQueueTransport().enqueueDeadLetter(
        {
          jobId: job.id,
          workspaceId: job.workspaceId,
          jobType: job.jobType,
          idempotencyKey: job.idempotencyKey,
          enqueuedAt: job.createdAt.toISOString(),
        },
        errMsg,
      );
    }

    getLogger().warn(
      { jobId: job.id, attempt: job.attempts, maxAttempts: job.maxAttempts, nextStatus, errMsg },
      'Worker job attempt failed',
    );

    return { processed: true, status: nextStatus };
  } finally {
    clearInterval(heartbeatInterval);
  }
}

/**
 * Executes one complete worker cycle:
 * 1. Recover stale locked jobs
 * 2. Dispatch pending transactional outbox events to SQS
 * 3. Receive and process up to bounded concurrency messages
 */
export async function runWorkerTick(
  workerId = `worker-${os.hostname()}-${process.pid}`,
): Promise<{ recovered: number; outboxDispatched: number; messagesProcessed: number }> {
  const env = getEnv();
  const recovered = await recoverStaleJobs();
  const outbox = await dispatchPendingOutboxEvents(env.WORKER_CONCURRENCY * 2);
  const queue = getJobQueueTransport();

  const messages = await queue.receive(env.WORKER_CONCURRENCY, env.WORKER_VISIBILITY_TIMEOUT_SEC);

  let messagesProcessed = 0;
  await Promise.all(
    messages.map(async (msg) => {
      const outcome = await processAnalysisJobById(msg.envelope.jobId, workerId);
      // Acknowledge once handled or already completed/cancelled/dead-lettered
      if (
        outcome.status === 'COMPLETED' ||
        outcome.status === 'CANCELLED' ||
        outcome.status === 'DEAD_LETTERED' ||
        outcome.status === 'MISSING'
      ) {
        await queue.acknowledge(msg.receiptHandle);
      }
      if (outcome.processed) {
        messagesProcessed += 1;
      }
    }),
  );

  return {
    recovered,
    outboxDispatched: outbox.dispatched,
    messagesProcessed,
  };
}
