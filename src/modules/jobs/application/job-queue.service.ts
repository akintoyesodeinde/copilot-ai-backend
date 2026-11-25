import type { AnalysisJobType, Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { NotFoundError } from '@/shared/http/problem-details';
import { paginateDescByCreatedAt, type PaginationParams } from '@/shared/http/pagination';
import { getJobQueueTransport } from '@/modules/jobs/infrastructure/sqs-queue';
import { getLogger } from '@/shared/logging/logger';

export interface EnqueueJobInput {
  workspaceId: string;
  repositoryId?: string | null;
  jobType: AnalysisJobType;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdByUserId?: string | null;
  maxAttempts?: number;
  priority?: number;
}

/**
 * Creates a durable AnalysisJob + transactional OutboxEvent atomically.
 * Idempotent on (workspaceId, idempotencyKey): duplicate triggers return the existing job.
 */
export async function enqueueAnalysisJob(input: EnqueueJobInput): Promise<{
  job: {
    id: string;
    workspaceId: string;
    repositoryId: string | null;
    jobType: AnalysisJobType;
    idempotencyKey: string;
    status: string;
    createdAt: string;
  };
  deduplicated: boolean;
}> {
  const prisma = getPrisma();

  const existing = await prisma.analysisJob.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });

  if (existing) {
    return {
      job: {
        id: existing.id,
        workspaceId: existing.workspaceId,
        repositoryId: existing.repositoryId,
        jobType: existing.jobType,
        idempotencyKey: existing.idempotencyKey,
        status: existing.status,
        createdAt: existing.createdAt.toISOString(),
      },
      deduplicated: true,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const job = await tx.analysisJob.create({
      data: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId ?? null,
        jobType: input.jobType,
        idempotencyKey: input.idempotencyKey,
        status: 'QUEUED',
        priority: input.priority ?? 5,
        payloadJson: input.payload as Prisma.InputJsonValue,
        maxAttempts: input.maxAttempts ?? 3,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    await tx.outboxEvent.create({
      data: {
        workspaceId: input.workspaceId,
        aggregateType: 'analysis_job',
        aggregateId: job.id,
        eventType: `job.${input.jobType.toLowerCase()}.queued`,
        dedupeKey: `job:${job.id}`,
        payloadJson: {
          jobId: job.id,
          workspaceId: job.workspaceId,
          jobType: job.jobType,
          idempotencyKey: job.idempotencyKey,
          enqueuedAt: job.createdAt.toISOString(),
        },
        status: 'PENDING',
      },
    });

    return job;
  });

  return {
    job: {
      id: created.id,
      workspaceId: created.workspaceId,
      repositoryId: created.repositoryId,
      jobType: created.jobType,
      idempotencyKey: created.idempotencyKey,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    },
    deduplicated: false,
  };
}

/**
 * Dispatches pending transactional outbox events to SQS (or in-memory test transport).
 */
export async function dispatchPendingOutboxEvents(batchSize = 20): Promise<{
  dispatched: number;
  failed: number;
}> {
  const prisma = getPrisma();
  const queue = getJobQueueTransport();
  const now = new Date();

  const events = await prisma.outboxEvent.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  let dispatched = 0;
  let failed = 0;

  for (const evt of events) {
    try {
      const payload = evt.payloadJson as {
        jobId: string;
        workspaceId: string;
        jobType: string;
        idempotencyKey: string;
        enqueuedAt: string;
      };
      await queue.enqueue(payload);
      await prisma.outboxEvent.update({
        where: { id: evt.id },
        data: {
          status: 'DISPATCHED',
          dispatchedAt: new Date(),
          attempts: evt.attempts + 1,
          lastError: null,
        },
      });
      dispatched += 1;
    } catch (error) {
      failed += 1;
      const attempts = evt.attempts + 1;
      const backoffMs = Math.min(300_000, 1000 * 2 ** attempts);
      await prisma.outboxEvent.update({
        where: { id: evt.id },
        data: {
          status: attempts >= 5 ? 'FAILED' : 'PENDING',
          attempts,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          lastError:
            error instanceof Error ? error.message.slice(0, 1000) : 'Outbox dispatch failed',
        },
      });
      getLogger().warn(
        { outboxId: evt.id, attempts },
        'Outbox event dispatch failed; scheduled retry',
      );
    }
  }

  return { dispatched, failed };
}

export async function recoverStaleJobs(now = new Date()): Promise<number> {
  const prisma = getPrisma();
  const res = await prisma.analysisJob.updateMany({
    where: {
      status: 'RUNNING',
      lockedUntil: { lt: now },
    },
    data: {
      status: 'QUEUED',
      workerId: null,
      lockedUntil: null,
      nextRunAt: now,
      lastError: 'Recovered after worker lock expiration (stale heartbeat)',
    },
  });
  return res.count;
}

export async function getWorkspaceJobById(workspaceId: string, jobId: string) {
  const prisma = getPrisma();
  const job = await prisma.analysisJob.findUnique({
    where: {
      workspaceId_id: { workspaceId, id: jobId },
    },
    include: {
      jobAttempts: {
        orderBy: { attemptNumber: 'asc' },
      },
    },
  });

  if (!job) {
    throw new NotFoundError('Analysis job not found in this workspace', 'JOB_NOT_FOUND');
  }

  return {
    id: job.id,
    workspaceId: job.workspaceId,
    repositoryId: job.repositoryId,
    jobType: job.jobType,
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    workerId: job.workerId,
    heartbeatAt: job.heartbeatAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    cancelledAt: job.cancelledAt?.toISOString() ?? null,
    lastError: job.lastError,
    result: job.resultJson,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    attemptHistory: job.jobAttempts.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      workerId: a.workerId,
      status: a.status,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      durationMs: a.durationMs,
    })),
  };
}

export async function listWorkspaceJobs(
  workspaceId: string,
  pagination: PaginationParams,
  filters?: { jobType?: AnalysisJobType; status?: string },
) {
  const prisma = getPrisma();
  const rows = await prisma.analysisJob.findMany({
    where: {
      workspaceId,
      ...(filters?.jobType ? { jobType: filters.jobType } : {}),
      ...(filters?.status ? { status: filters.status as never } : {}),
      ...(pagination.cursor
        ? {
            OR: [
              { createdAt: { lt: pagination.cursor.createdAt } },
              { createdAt: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });

  const paged = paginateDescByCreatedAt(rows, pagination.limit);
  return {
    items: paged.items.map((job) => ({
      id: job.id,
      workspaceId: job.workspaceId,
      repositoryId: job.repositoryId,
      jobType: job.jobType,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
    })),
    pagination: paged.pagination,
  };
}

export async function cancelWorkspaceJob(workspaceId: string, jobId: string) {
  const prisma = getPrisma();
  const updated = await prisma.analysisJob.updateMany({
    where: {
      workspaceId,
      id: jobId,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    },
  });
  return updated.count > 0;
}
