import type {
  CodeReviewStatus,
  FindingSeverity,
  Prisma,
  ReviewFeedbackVote,
  ReviewRiskLevel,
} from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/http/problem-details';
import { paginateDescByCreatedAt, type PaginationParams } from '@/shared/http/pagination';
import type { RequestContext } from '@/shared/http/route-handler';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import { getGithubGateway } from '@/modules/github/infrastructure/github-client';
import { retrieveRelevantCodeChunks } from '@/modules/indexing/application/indexing.service';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';
import { wrapUntrustedRepositoryContent } from '@/modules/ai/domain/types';
import { invokeStructuredPrReview } from '@/modules/ai/application/ai-orchestrator.service';
import { assertValidReviewTransition } from '@/modules/reviews/domain/state-machine';
import {
  runDeterministicDiffChecks,
  validateAndNormalizeFindings,
} from '@/modules/reviews/domain/finding-validator';

// ============================================================================
// Pull Request Read Operations
// ============================================================================

export async function listWorkspacePullRequests(
  workspaceId: string,
  pagination: PaginationParams,
  filters?: { repositoryId?: string; state?: 'OPEN' | 'CLOSED' | 'MERGED' },
) {
  const prisma = getPrisma();
  const rows = await prisma.pullRequest.findMany({
    where: {
      workspaceId,
      repository: { isActive: true, accessRevokedAt: null },
      ...(filters?.repositoryId ? { repositoryId: filters.repositoryId } : {}),
      ...(filters?.state ? { state: filters.state } : {}),
      ...(pagination.cursor
        ? {
            OR: [
              { createdAt: { lt: pagination.cursor.createdAt } },
              { createdAt: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
            ],
          }
        : {}),
    },
    include: {
      repository: { select: { id: true, fullName: true, name: true, ownerLogin: true } },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          overallRisk: true,
          findingsCount: true,
          headSha: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });

  const paged = paginateDescByCreatedAt(rows, pagination.limit);

  return {
    items: paged.items.map((pr) => ({
      id: pr.id,
      workspaceId: pr.workspaceId,
      repositoryId: pr.repositoryId,
      repository: pr.repository,
      prNumber: pr.prNumber,
      title: pr.title,
      state: pr.state,
      authorLogin: pr.authorLogin,
      baseBranch: pr.baseBranch,
      headBranch: pr.headBranch,
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      isDraft: pr.isDraft,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFilesCount: pr.changedFilesCount,
      htmlUrl: pr.htmlUrl,
      latestReview: pr.reviews[0]
        ? {
            ...pr.reviews[0],
            createdAt: pr.reviews[0].createdAt.toISOString(),
          }
        : null,
      createdAt: pr.createdAt.toISOString(),
      updatedAt: pr.updatedAt.toISOString(),
    })),
    pagination: paged.pagination,
  };
}

export async function getWorkspacePullRequestDetail(workspaceId: string, pullRequestId: string) {
  const prisma = getPrisma();
  const pr = await prisma.pullRequest.findUnique({
    where: { workspaceId_id: { workspaceId, id: pullRequestId } },
    include: {
      repository: {
        select: {
          id: true,
          fullName: true,
          name: true,
          ownerLogin: true,
          isActive: true,
          accessRevokedAt: true,
        },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!pr || !pr.repository.isActive || pr.repository.accessRevokedAt !== null) {
    throw new NotFoundError('Pull request not found in this workspace', 'PULL_REQUEST_NOT_FOUND');
  }

  return {
    id: pr.id,
    workspaceId: pr.workspaceId,
    repositoryId: pr.repositoryId,
    repository: {
      id: pr.repository.id,
      fullName: pr.repository.fullName,
      name: pr.repository.name,
      ownerLogin: pr.repository.ownerLogin,
    },
    prNumber: pr.prNumber,
    title: pr.title,
    description: pr.description,
    state: pr.state,
    authorLogin: pr.authorLogin,
    baseBranch: pr.baseBranch,
    headBranch: pr.headBranch,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    isDraft: pr.isDraft,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFilesCount: pr.changedFilesCount,
    htmlUrl: pr.htmlUrl,
    reviews: pr.reviews.map((r) => ({
      id: r.id,
      headSha: r.headSha,
      policyVersion: r.policyVersion,
      status: r.status,
      overallRisk: r.overallRisk,
      findingsCount: r.findingsCount,
      rejectedFindingsCount: r.rejectedFindingsCount,
      requiresApproval: r.requiresApproval,
      analysisJobId: r.analysisJobId,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectedAt: r.rejectedAt?.toISOString() ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    createdAt: pr.createdAt.toISOString(),
    updatedAt: pr.updatedAt.toISOString(),
  };
}

export async function getWorkspacePullRequestDiff(workspaceId: string, pullRequestId: string) {
  const prisma = getPrisma();
  const pr = await prisma.pullRequest.findUnique({
    where: { workspaceId_id: { workspaceId, id: pullRequestId } },
    include: {
      repository: { select: { isActive: true, accessRevokedAt: true } },
    },
  });

  if (!pr || !pr.repository.isActive || pr.repository.accessRevokedAt !== null) {
    throw new NotFoundError('Pull request not found in this workspace', 'PULL_REQUEST_NOT_FOUND');
  }

  const files = await prisma.pullRequestFile.findMany({
    where: { workspaceId, pullRequestId, headSha: pr.headSha },
    orderBy: { filePath: 'asc' },
  });

  return {
    pullRequestId: pr.id,
    headSha: pr.headSha,
    files: files.map((f) => ({
      id: f.id,
      filePath: f.filePath,
      previousFilePath: f.previousFilePath,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    })),
  };
}

// ============================================================================
// Schedule & Execute Automated PR Reviews (12-State Machine)
// ============================================================================

export async function schedulePullRequestReview(
  workspaceId: string,
  pullRequestId: string,
  actorUserId: string,
  ctx: RequestContext,
  policyVersion = 'v1',
) {
  const prisma = getPrisma();
  const pr = await prisma.pullRequest.findUnique({
    where: { workspaceId_id: { workspaceId, id: pullRequestId } },
    include: {
      repository: { select: { id: true, isActive: true, accessRevokedAt: true } },
    },
  });

  if (!pr || !pr.repository.isActive || pr.repository.accessRevokedAt !== null) {
    throw new NotFoundError('Pull request not found or repository access revoked');
  }

  const settings = await prisma.workspaceSetting.findUnique({ where: { workspaceId } });
  const requiresApproval = settings?.requireHumanApproval ?? true;

  const idempotencyKey = `pr-review:${pr.id}:${pr.headSha}:${policyVersion}`;
  const enqueued = await enqueueAnalysisJob({
    workspaceId,
    repositoryId: pr.repositoryId,
    jobType: 'PR_REVIEW',
    idempotencyKey,
    createdByUserId: actorUserId,
    payload: {
      pullRequestId: pr.id,
      repositoryId: pr.repositoryId,
      headSha: pr.headSha,
      policyVersion,
    },
  });

  const review = await prisma.codeReview.upsert({
    where: {
      workspaceId_pullRequestId_headSha_policyVersion: {
        workspaceId,
        pullRequestId: pr.id,
        headSha: pr.headSha,
        policyVersion,
      },
    },
    update: {},
    create: {
      workspaceId,
      repositoryId: pr.repositoryId,
      pullRequestId: pr.id,
      headSha: pr.headSha,
      policyVersion,
      status: 'QUEUED',
      analysisJobId: enqueued.job.id,
      requiresApproval,
    },
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'review.scheduled',
    resourceType: 'code_review',
    resourceId: review.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      pullRequestId: pr.id,
      headSha: pr.headSha,
      jobId: enqueued.job.id,
      deduplicated: enqueued.deduplicated,
    },
  });

  return {
    reviewId: review.id,
    jobId: enqueued.job.id,
    status: review.status,
    headSha: review.headSha,
    deduplicated: enqueued.deduplicated,
  };
}

async function transitionReviewStatus(
  workspaceId: string,
  reviewId: string,
  nextStatus: CodeReviewStatus,
  extraData?: Prisma.CodeReviewUpdateInput,
) {
  const prisma = getPrisma();
  const current = await prisma.codeReview.findUnique({
    where: { workspaceId_id: { workspaceId, id: reviewId } },
    select: { status: true },
  });
  if (!current) {
    throw new NotFoundError('Code review not found');
  }
  assertValidReviewTransition(current.status, nextStatus);
  return prisma.codeReview.update({
    where: { workspaceId_id: { workspaceId, id: reviewId } },
    data: {
      status: nextStatus,
      ...extraData,
    },
  });
}

export async function executePullRequestReviewJob(params: {
  workspaceId: string;
  repositoryId: string;
  pullRequestId: string;
  headSha: string;
  policyVersion: string;
  analysisJobId: string;
}) {
  const prisma = getPrisma();
  const pr = await prisma.pullRequest.findUnique({
    where: { workspaceId_id: { workspaceId: params.workspaceId, id: params.pullRequestId } },
    include: {
      repository: { include: { githubInstallation: true } },
    },
  });

  if (!pr || !pr.repository.isActive || pr.repository.accessRevokedAt !== null) {
    throw new NotFoundError('Pull request or repository is no longer active');
  }

  const settings = await prisma.workspaceSetting.findUnique({
    where: { workspaceId: params.workspaceId },
  });
  const requiresApproval = settings?.requireHumanApproval ?? true;

  // Idempotent lookup/creation of CodeReview record for (workspaceId, pullRequestId, headSha, policyVersion)
  let review = await prisma.codeReview.upsert({
    where: {
      workspaceId_pullRequestId_headSha_policyVersion: {
        workspaceId: params.workspaceId,
        pullRequestId: pr.id,
        headSha: params.headSha,
        policyVersion: params.policyVersion,
      },
    },
    update: {
      analysisJobId: params.analysisJobId,
    },
    create: {
      workspaceId: params.workspaceId,
      repositoryId: pr.repositoryId,
      pullRequestId: pr.id,
      headSha: params.headSha,
      policyVersion: params.policyVersion,
      status: 'QUEUED',
      analysisJobId: params.analysisJobId,
      requiresApproval,
    },
  });

  // Skip reprocessing if already completed/awaiting approval/published (prevents duplicate review records!)
  if (
    review.status === 'AWAITING_APPROVAL' ||
    review.status === 'COMPLETED' ||
    review.status === 'COMPLETED_WITH_WARNINGS' ||
    review.status === 'PUBLISHED'
  ) {
    return {
      reviewId: review.id,
      status: review.status,
      findingsCount: review.findingsCount,
      deduplicated: true,
    };
  }

  // If retrying after FAILED, return to QUEUED first
  if (review.status === 'FAILED') {
    review = await transitionReviewStatus(params.workspaceId, review.id, 'QUEUED', {
      errorMessage: null,
    });
  }

  try {
    // State: FETCHING_CONTEXT
    await transitionReviewStatus(params.workspaceId, review.id, 'FETCHING_CONTEXT');

    let changedFiles = await prisma.pullRequestFile.findMany({
      where: {
        workspaceId: params.workspaceId,
        pullRequestId: pr.id,
        headSha: params.headSha,
      },
    });

    if (changedFiles.length === 0) {
      const ghInstallId =
        pr.repository.githubInstallation?.githubInstallationId ?? BigInt(90000101);
      const remoteFiles = await getGithubGateway().listPullRequestFiles(
        ghInstallId,
        pr.repository.ownerLogin,
        pr.repository.name,
        pr.prNumber,
      );
      for (const rf of remoteFiles) {
        await prisma.pullRequestFile.upsert({
          where: {
            workspaceId_pullRequestId_headSha_filePath: {
              workspaceId: params.workspaceId,
              pullRequestId: pr.id,
              headSha: params.headSha,
              filePath: rf.filePath,
            },
          },
          update: { patch: rf.patch, additions: rf.additions, deletions: rf.deletions },
          create: {
            workspaceId: params.workspaceId,
            pullRequestId: pr.id,
            headSha: params.headSha,
            filePath: rf.filePath,
            previousFilePath: rf.previousFilePath,
            status: rf.status,
            additions: rf.additions,
            deletions: rf.deletions,
            patch: rf.patch,
            blobSha: rf.blobSha,
          },
        });
      }
      changedFiles = await prisma.pullRequestFile.findMany({
        where: {
          workspaceId: params.workspaceId,
          pullRequestId: pr.id,
          headSha: params.headSha,
        },
      });
    }

    const queryTerms = `${pr.title} ${changedFiles.map((f) => f.filePath).join(' ')}`;
    const contextChunks = await retrieveRelevantCodeChunks(
      params.workspaceId,
      pr.repositoryId,
      queryTerms,
      5,
    );

    // State: ANALYZING
    await transitionReviewStatus(params.workspaceId, review.id, 'ANALYZING');

    const diffInputs = changedFiles.map((f) => ({ filePath: f.filePath, patch: f.patch }));
    const deterministicFindings = runDeterministicDiffChecks(diffInputs);

    const promptSections = [
      `Pull Request #${pr.prNumber}: ${pr.title}`,
      wrapUntrustedRepositoryContent('pr_description', pr.description ?? ''),
      ...diffInputs.map((f) =>
        wrapUntrustedRepositoryContent(`diff:${f.filePath}`, f.patch ?? '(no text patch)'),
      ),
      ...contextChunks.map((c) =>
        wrapUntrustedRepositoryContent(
          `context:${c.filePath}:${c.startLine}-${c.endLine}`,
          c.content,
        ),
      ),
    ];

    const aiResult = await invokeStructuredPrReview({
      workspaceId: params.workspaceId,
      repositoryId: pr.repositoryId,
      analysisJobId: params.analysisJobId,
      userPrompt: promptSections.join('\n\n'),
      changedFiles: diffInputs,
    });

    // State: VALIDATING
    await transitionReviewStatus(params.workspaceId, review.id, 'VALIDATING');

    const normalized = validateAndNormalizeFindings(
      diffInputs,
      deterministicFindings,
      aiResult.output.findings,
    );

    const computedRisk: ReviewRiskLevel = normalized.accepted.some((f) => f.severity === 'CRITICAL')
      ? 'CRITICAL'
      : normalized.accepted.some((f) => f.severity === 'HIGH')
        ? 'HIGH'
        : normalized.accepted.some((f) => f.severity === 'MEDIUM')
          ? 'MEDIUM'
          : aiResult.output.overallRisk;

    const warnings: string[] = [];
    if (normalized.rejectedCount > 0) {
      warnings.push(
        `${normalized.rejectedCount} unverified AI finding(s) were rejected during file/line validation.`,
      );
    }
    if (aiResult.promptInjectionSignals.length > 0) {
      warnings.push(
        `Detected ${aiResult.promptInjectionSignals.length} prompt-injection pattern(s) in untrusted repository content; security policies remained enforced.`,
      );
    }

    const summaryWithNotes =
      warnings.length > 0
        ? `${aiResult.output.summaryMarkdown}\n\n**Validation Warnings:**\n${warnings.map((w) => `- ${w}`).join('\n')}`
        : aiResult.output.summaryMarkdown;

    const finalState: CodeReviewStatus = requiresApproval
      ? 'AWAITING_APPROVAL'
      : warnings.length > 0
        ? 'COMPLETED_WITH_WARNINGS'
        : 'COMPLETED';

    await prisma.$transaction(async (tx) => {
      for (const f of normalized.accepted) {
        await tx.reviewFinding.upsert({
          where: {
            workspaceId_codeReviewId_fingerprint: {
              workspaceId: params.workspaceId,
              codeReviewId: review.id,
              fingerprint: f.fingerprint,
            },
          },
          update: {
            severity: f.severity,
            description: f.description,
            suggestion: f.suggestion,
          },
          create: {
            workspaceId: params.workspaceId,
            codeReviewId: review.id,
            fingerprint: f.fingerprint,
            source: f.source,
            severity: f.severity,
            category: f.category,
            title: f.title,
            description: f.description,
            suggestion: f.suggestion,
            filePath: f.filePath,
            startLine: f.startLine,
            endLine: f.endLine,
            evidenceSnippet: f.evidenceSnippet,
            confidence: f.confidence,
          },
        });
      }

      await tx.codeReview.update({
        where: { workspaceId_id: { workspaceId: params.workspaceId, id: review.id } },
        data: {
          status: finalState,
          summaryMarkdown: summaryWithNotes,
          overallRisk: computedRisk,
          findingsCount: normalized.accepted.length,
          rejectedFindingsCount: normalized.rejectedCount,
        },
      });
    });

    return {
      reviewId: review.id,
      status: finalState,
      overallRisk: computedRisk,
      findingsCount: normalized.accepted.length,
      rejectedFindingsCount: normalized.rejectedCount,
      promptInjectionSignalsDetected: aiResult.promptInjectionSignals.length,
    };
  } catch (error) {
    await prisma.codeReview.update({
      where: { workspaceId_id: { workspaceId: params.workspaceId, id: review.id } },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Review failed',
      },
    });
    throw error;
  }
}

// ============================================================================
// Review Retrieval, Approval, Rejection, Publishing & Feedback
// ============================================================================

export async function getReviewDetail(workspaceId: string, reviewId: string) {
  const prisma = getPrisma();
  const review = await prisma.codeReview.findUnique({
    where: { workspaceId_id: { workspaceId, id: reviewId } },
    include: {
      pullRequest: {
        select: {
          id: true,
          prNumber: true,
          title: true,
          headSha: true,
          baseBranch: true,
          headBranch: true,
        },
      },
      repository: {
        select: { id: true, fullName: true },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!review) {
    throw new NotFoundError('Code review not found in this workspace', 'REVIEW_NOT_FOUND');
  }

  return {
    id: review.id,
    workspaceId: review.workspaceId,
    repository: review.repository,
    pullRequest: review.pullRequest,
    headSha: review.headSha,
    policyVersion: review.policyVersion,
    status: review.status,
    analysisJobId: review.analysisJobId,
    summaryMarkdown: review.summaryMarkdown,
    overallRisk: review.overallRisk,
    findingsCount: review.findingsCount,
    rejectedFindingsCount: review.rejectedFindingsCount,
    requiresApproval: review.requiresApproval,
    approvedAt: review.approvedAt?.toISOString() ?? null,
    rejectedAt: review.rejectedAt?.toISOString() ?? null,
    rejectionReason: review.rejectionReason,
    publishedAt: review.publishedAt?.toISOString() ?? null,
    githubReviewId: review.githubReviewId?.toString() ?? null,
    publishedCommentsCount: review.comments.length,
    errorMessage: review.errorMessage,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export async function listReviewFindings(
  workspaceId: string,
  reviewId: string,
  severity?: FindingSeverity,
) {
  const prisma = getPrisma();
  const review = await prisma.codeReview.findUnique({
    where: { workspaceId_id: { workspaceId, id: reviewId } },
    select: { id: true },
  });
  if (!review) {
    throw new NotFoundError('Code review not found in this workspace', 'REVIEW_NOT_FOUND');
  }

  const findings = await prisma.reviewFinding.findMany({
    where: {
      workspaceId,
      codeReviewId: reviewId,
      ...(severity ? { severity } : {}),
    },
    include: {
      feedbacks: {
        select: { userId: true, vote: true, comment: true },
      },
    },
    orderBy: [{ severity: 'asc' }, { filePath: 'asc' }, { startLine: 'asc' }],
  });

  return findings.map((f) => ({
    id: f.id,
    fingerprint: f.fingerprint,
    source: f.source,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    suggestion: f.suggestion,
    filePath: f.filePath,
    startLine: f.startLine,
    endLine: f.endLine,
    evidenceSnippet: f.evidenceSnippet,
    confidence: f.confidence !== null ? Number(f.confidence) : null,
    isPublished: f.isPublished,
    feedbackSummary: {
      helpful: f.feedbacks.filter((fb) => fb.vote === 'HELPFUL').length,
      notHelpful: f.feedbacks.filter((fb) => fb.vote === 'NOT_HELPFUL').length,
      falsePositive: f.feedbacks.filter((fb) => fb.vote === 'FALSE_POSITIVE').length,
    },
    createdAt: f.createdAt.toISOString(),
  }));
}

export async function approveReview(
  workspaceId: string,
  reviewId: string,
  actorUserId: string,
  ctx: RequestContext,
) {
  const updated = await transitionReviewStatus(workspaceId, reviewId, 'COMPLETED', {
    approvedBy: { connect: { id: actorUserId } },
    approvedAt: new Date(),
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'review.approved',
    resourceType: 'code_review',
    resourceId: reviewId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    id: updated.id,
    status: updated.status,
    approvedAt: updated.approvedAt?.toISOString() ?? null,
  };
}

export async function rejectReview(
  workspaceId: string,
  reviewId: string,
  actorUserId: string,
  reason: string | undefined,
  ctx: RequestContext,
) {
  const updated = await transitionReviewStatus(workspaceId, reviewId, 'REJECTED', {
    rejectedBy: { connect: { id: actorUserId } },
    rejectedAt: new Date(),
    rejectionReason: reason?.slice(0, 500) ?? null,
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'review.rejected',
    resourceType: 'code_review',
    resourceId: reviewId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { reason: reason ?? null },
  });

  return {
    id: updated.id,
    status: updated.status,
    rejectedAt: updated.rejectedAt?.toISOString() ?? null,
    rejectionReason: updated.rejectionReason,
  };
}

export async function publishReviewToGithub(
  workspaceId: string,
  reviewId: string,
  actorUserId: string,
  ctx: RequestContext,
) {
  const prisma = getPrisma();
  const review = await prisma.codeReview.findUnique({
    where: { workspaceId_id: { workspaceId, id: reviewId } },
    include: {
      pullRequest: true,
      repository: { include: { githubInstallation: true } },
      findings: true,
      comments: true,
    },
  });

  if (!review) {
    throw new NotFoundError('Code review not found in this workspace', 'REVIEW_NOT_FOUND');
  }

  if (!review.repository.isActive || review.repository.accessRevokedAt !== null) {
    throw new ForbiddenError('Repository access has been revoked; publication blocked');
  }

  // Idempotent return if already published
  if (review.status === 'PUBLISHED') {
    return {
      id: review.id,
      status: review.status,
      githubReviewId: review.githubReviewId?.toString() ?? null,
      publishedCommentsCount: review.comments.length,
      alreadyPublished: true,
    };
  }

  // Enforce human approval policy before publishing
  if (review.requiresApproval && !review.approvedAt) {
    throw new ForbiddenError(
      'Human approval is required before publishing this review to GitHub',
      'REVIEW_APPROVAL_REQUIRED',
    );
  }

  assertValidReviewTransition(review.status, 'PUBLISHED');

  const gateway = getGithubGateway();
  const ghInstallId =
    review.repository.githubInstallation?.githubInstallationId ?? BigInt(90000101);

  // Critical safety check: verify live GitHub PR head SHA has not changed!
  const livePr = await gateway.getPullRequest(
    ghInstallId,
    review.repository.ownerLogin,
    review.repository.name,
    review.pullRequest.prNumber,
  );

  if (livePr.headSha !== review.headSha) {
    await prisma.codeReview.update({
      where: { workspaceId_id: { workspaceId, id: review.id } },
      data: {
        status: 'SUPERSEDED',
        errorMessage: `PR head SHA changed from ${review.headSha} to ${livePr.headSha}`,
      },
    });
    throw new ConflictError(
      `Pull request head commit SHA changed (${review.headSha.slice(0, 7)} -> ${livePr.headSha.slice(0, 7)}). Re-run review on latest commit before publishing.`,
      'STALE_PR_HEAD_SHA',
    );
  }

  // Reconcile against existing GitHub comments & durable review_comments to prevent duplicates
  const existingGhComments = await gateway.listExistingReviewComments(
    ghInstallId,
    review.repository.ownerLogin,
    review.repository.name,
    review.pullRequest.prNumber,
  );
  const existingDurableKeys = new Set(review.comments.map((c) => c.publicationKey));

  const commentsToPublish = review.findings
    .map((f) => {
      const publicationKey = `${review.id}:${f.fingerprint}`;
      const body = `**[${f.severity} · ${f.source}] ${f.title}**\n\n${f.description}${
        f.suggestion ? `\n\n**Suggestion:** ${f.suggestion}` : ''
      }`;
      return {
        findingId: f.id,
        filePath: f.filePath,
        lineNumber: f.startLine,
        body,
        publicationKey,
      };
    })
    .filter((c) => {
      if (existingDurableKeys.has(c.publicationKey)) return false;
      const marker = `codepilot-key:${c.publicationKey}`;
      return !existingGhComments.some((gh) => gh.body.includes(marker));
    });

  const publishResult = await gateway.publishPullRequestReview({
    installationId: ghInstallId,
    owner: review.repository.ownerLogin,
    repo: review.repository.name,
    prNumber: review.pullRequest.prNumber,
    commitSha: review.headSha,
    summaryBody: review.summaryMarkdown ?? 'CodePilot AI Automated Pull Request Review',
    comments: commentsToPublish.map((c) => ({
      filePath: c.filePath,
      lineNumber: c.lineNumber,
      body: c.body,
      publicationKey: c.publicationKey,
    })),
  });

  const now = new Date();
  const commentIdByKey = new Map(
    publishResult.publishedComments.map((c) => [c.publicationKey, c.githubCommentId]),
  );

  await prisma.$transaction(async (tx) => {
    for (const c of commentsToPublish) {
      await tx.reviewComment.upsert({
        where: { publicationKey: c.publicationKey },
        update: {},
        create: {
          workspaceId,
          codeReviewId: review.id,
          findingId: c.findingId,
          publicationKey: c.publicationKey,
          githubCommentId: commentIdByKey.get(c.publicationKey) ?? null,
          filePath: c.filePath,
          lineNumber: c.lineNumber,
          bodyMarkdown: c.body,
          publishedAt: now,
        },
      });
    }

    await tx.reviewFinding.updateMany({
      where: { workspaceId, codeReviewId: review.id },
      data: { isPublished: true },
    });

    await tx.codeReview.update({
      where: { workspaceId_id: { workspaceId, id: review.id } },
      data: {
        status: 'PUBLISHED',
        publishedByUserId: actorUserId,
        publishedAt: now,
        githubReviewId: publishResult.githubReviewId,
        publicationIdempotencyKey: `publish:${review.id}:${review.headSha}`,
      },
    });
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'review.published',
    resourceType: 'code_review',
    resourceId: review.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      githubReviewId: publishResult.githubReviewId.toString(),
      commentsPublished: commentsToPublish.length,
    },
  });

  return {
    id: review.id,
    status: 'PUBLISHED',
    githubReviewId: publishResult.githubReviewId.toString(),
    publishedCommentsCount: commentsToPublish.length,
    alreadyPublished: false,
  };
}

export async function submitFindingFeedback(
  workspaceId: string,
  findingId: string,
  userId: string,
  vote: ReviewFeedbackVote,
  comment: string | undefined,
) {
  const prisma = getPrisma();
  const finding = await prisma.reviewFinding.findUnique({
    where: { workspaceId_id: { workspaceId, id: findingId } },
    select: { id: true },
  });
  if (!finding) {
    throw new NotFoundError('Review finding not found in this workspace', 'FINDING_NOT_FOUND');
  }

  const saved = await prisma.reviewFeedback.upsert({
    where: {
      workspaceId_findingId_userId: { workspaceId, findingId, userId },
    },
    update: {
      vote,
      comment: comment?.trim() || null,
    },
    create: {
      workspaceId,
      findingId,
      userId,
      vote,
      comment: comment?.trim() || null,
    },
  });

  return {
    id: saved.id,
    findingId: saved.findingId,
    vote: saved.vote,
    comment: saved.comment,
    updatedAt: saved.updatedAt.toISOString(),
  };
}
