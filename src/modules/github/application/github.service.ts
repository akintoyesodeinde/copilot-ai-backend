import type { Prisma } from '@/generated/prisma/client';
import { getEnv } from '@/config/env';
import { getPrisma } from '@/shared/database/prisma';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@/shared/http/problem-details';
import type { RequestContext } from '@/shared/http/route-handler';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import {
  createGithubInstallState,
  verifyGithubInstallState,
  verifyGithubWebhookSignature,
} from '@/modules/github/domain/webhook-signature';
import { getGithubGateway } from '@/modules/github/infrastructure/github-client';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';

export const LEAST_PRIVILEGE_APP_PERMISSIONS = {
  contents: 'read',
  metadata: 'read',
  pull_requests: 'write',
  checks: 'write',
} as const;

export function buildGithubInstallRedirectUrl(
  workspaceId: string,
  userId: string,
): {
  installUrl: string;
  state: string;
  mode: 'live' | 'fixture';
  requestedPermissions: typeof LEAST_PRIVILEGE_APP_PERMISSIONS;
} {
  const env = getEnv();
  const state = createGithubInstallState(workspaceId, userId);

  if (env.GITHUB_MODE === 'live') {
    const slug = env.GITHUB_APP_SLUG || 'codepilot-ai';
    return {
      installUrl: `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`,
      state,
      mode: 'live',
      requestedPermissions: LEAST_PRIVILEGE_APP_PERMISSIONS,
    };
  }

  // Deterministic local/sandbox callback URL for fixture mode
  const syntheticInstallationId = 90000000 + Math.floor(Math.random() * 900000);
  return {
    installUrl: `${env.APP_URL}/api/v1/github/callback?installation_id=${syntheticInstallationId}&setup_action=install&state=${encodeURIComponent(state)}`,
    state,
    mode: 'fixture',
    requestedPermissions: LEAST_PRIVILEGE_APP_PERMISSIONS,
  };
}

export async function handleGithubInstallCallback(
  params: { installationIdRaw: string | null; state: string | null },
  ctx: RequestContext,
) {
  if (!params.installationIdRaw || !params.state) {
    throw new ValidationError('Missing installation_id or state parameter');
  }

  let githubInstallationId: bigint;
  try {
    githubInstallationId = BigInt(params.installationIdRaw);
  } catch {
    throw new ValidationError('installation_id must be a numeric GitHub installation ID');
  }

  const statePayload = verifyGithubInstallState(params.state);
  const prisma = getPrisma();

  // Verify caller still has active membership with repository:write / workspace access
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: statePayload.workspaceId,
        userId: statePayload.userId,
      },
    },
  });
  if (!membership || membership.status !== 'ACTIVE' || membership.roleKey === 'VIEWER') {
    throw new ForbiddenError('Caller is not authorized to install GitHub Apps in this workspace');
  }

  // Prevent hijacking an installation already bound to a different workspace
  const existing = await prisma.githubInstallation.findUnique({
    where: { githubInstallationId },
  });
  if (existing && existing.workspaceId !== statePayload.workspaceId) {
    throw new ConflictError(
      'This GitHub App installation is already connected to another workspace',
      'INSTALLATION_ALREADY_BOUND',
    );
  }

  const gateway = getGithubGateway();
  const metadata = await gateway.getInstallationMetadata(githubInstallationId);

  const installation = await prisma.githubInstallation.upsert({
    where: { githubInstallationId },
    update: {
      status: 'ACTIVE',
      accountLogin: metadata.accountLogin,
      accountType: metadata.accountType,
      targetType: metadata.targetType,
      permissionsJson: metadata.permissions as Prisma.InputJsonValue,
      revokedAt: null,
    },
    create: {
      workspaceId: statePayload.workspaceId,
      githubInstallationId,
      accountLogin: metadata.accountLogin,
      accountType: metadata.accountType,
      targetType: metadata.targetType,
      status: 'ACTIVE',
      permissionsJson: metadata.permissions as Prisma.InputJsonValue,
      installedByUserId: statePayload.userId,
    },
  });

  // Synchronize repositories immediately into the tenant workspace
  const syncedRepos = await syncInstallationRepositories(
    statePayload.workspaceId,
    installation.id,
    githubInstallationId,
  );

  await recordAuditEvent({
    workspaceId: statePayload.workspaceId,
    actorUserId: statePayload.userId,
    action: 'github.installation.connected',
    resourceType: 'github_installation',
    resourceId: installation.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      githubInstallationId: githubInstallationId.toString(),
      accountLogin: installation.accountLogin,
      repositoriesSynced: syncedRepos.length,
    },
  });

  return {
    id: installation.id,
    workspaceId: installation.workspaceId,
    githubInstallationId: installation.githubInstallationId.toString(),
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    status: installation.status,
    repositoriesSynced: syncedRepos.length,
  };
}

export async function listWorkspaceGithubInstallations(workspaceId: string) {
  const prisma = getPrisma();
  const rows = await prisma.githubInstallation.findMany({
    where: { workspaceId },
    include: {
      _count: {
        select: {
          repositories: { where: { isActive: true, accessRevokedAt: null } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    githubInstallationId: row.githubInstallationId.toString(),
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    targetType: row.targetType,
    status: row.status,
    permissions: row.permissionsJson,
    repositoryCount: row._count.repositories,
    installedAt: row.installedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeWorkspaceGithubInstallation(
  workspaceId: string,
  installationId: string,
  actorUserId: string,
  ctx: RequestContext,
) {
  const prisma = getPrisma();
  const existing = await prisma.githubInstallation.findUnique({
    where: {
      workspaceId_id: { workspaceId, id: installationId },
    },
  });

  if (!existing) {
    throw new NotFoundError(
      'GitHub installation not found in this workspace',
      'INSTALLATION_NOT_FOUND',
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.githubInstallation.update({
      where: { id: existing.id },
      data: {
        status: 'REVOKED',
        revokedAt: now,
      },
    }),
    prisma.repository.updateMany({
      where: {
        workspaceId,
        githubInstallationId: existing.id,
      },
      data: {
        isActive: false,
        accessRevokedAt: now,
      },
    }),
  ]);

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'github.installation.revoked',
    resourceType: 'github_installation',
    resourceId: existing.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { id: existing.id, status: 'REVOKED', revokedAt: now.toISOString() };
}

export async function syncInstallationRepositories(
  workspaceId: string,
  installationRecordId: string,
  githubInstallationId: bigint,
) {
  const prisma = getPrisma();
  const gateway = getGithubGateway();
  const remoteRepos = await gateway.listInstallationRepositories(githubInstallationId);
  const synced: Array<{ id: string; fullName: string }> = [];

  for (const r of remoteRepos) {
    const repo = await prisma.repository.upsert({
      where: {
        workspaceId_githubRepoId: {
          workspaceId,
          githubRepoId: r.githubRepoId,
        },
      },
      update: {
        githubInstallationId: installationRecordId,
        ownerLogin: r.ownerLogin,
        name: r.name,
        fullName: r.fullName,
        description: r.description,
        defaultBranch: r.defaultBranch,
        visibility: r.visibility,
        primaryLanguage: r.primaryLanguage,
        isActive: true,
        accessRevokedAt: null,
        lastSyncedAt: new Date(),
      },
      create: {
        workspaceId,
        githubInstallationId: installationRecordId,
        githubRepoId: r.githubRepoId,
        ownerLogin: r.ownerLogin,
        name: r.name,
        fullName: r.fullName,
        description: r.description,
        defaultBranch: r.defaultBranch,
        visibility: r.visibility,
        primaryLanguage: r.primaryLanguage,
        isActive: true,
        lastSyncedAt: new Date(),
      },
    });
    synced.push({ id: repo.id, fullName: repo.fullName });
  }

  return synced;
}

export async function executeRepoSyncJob(workspaceId: string, repositoryId: string) {
  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    include: { githubInstallation: true },
  });

  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository is inactive or access has been revoked');
  }
  if (!repo.githubInstallation || repo.githubInstallation.status !== 'ACTIVE') {
    throw new ForbiddenError('GitHub App installation is not active for this repository');
  }

  const gateway = getGithubGateway();
  const ghInstallId = repo.githubInstallation.githubInstallationId;

  const [branches, commits, pullRequests] = await Promise.all([
    gateway.listBranches(ghInstallId, repo.ownerLogin, repo.name),
    gateway.listCommits(ghInstallId, repo.ownerLogin, repo.name, repo.defaultBranch),
    gateway.listPullRequests(ghInstallId, repo.ownerLogin, repo.name),
  ]);

  for (const b of branches) {
    await prisma.repositoryBranch.upsert({
      where: {
        workspaceId_repositoryId_name: { workspaceId, repositoryId, name: b.name },
      },
      update: {
        headSha: b.headSha,
        isDefault: b.name === repo.defaultBranch,
        isProtected: b.isProtected,
      },
      create: {
        workspaceId,
        repositoryId,
        name: b.name,
        headSha: b.headSha,
        isDefault: b.name === repo.defaultBranch,
        isProtected: b.isProtected,
      },
    });
  }

  for (const c of commits) {
    await prisma.repositoryCommit.upsert({
      where: {
        workspaceId_repositoryId_sha: { workspaceId, repositoryId, sha: c.sha },
      },
      update: {},
      create: {
        workspaceId,
        repositoryId,
        sha: c.sha,
        messageHeadline: c.messageHeadline,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        committedAt: c.committedAt,
      },
    });
  }

  let prSyncedCount = 0;
  for (const pr of pullRequests) {
    const savedPr = await prisma.pullRequest.upsert({
      where: {
        workspaceId_repositoryId_prNumber: {
          workspaceId,
          repositoryId,
          prNumber: pr.prNumber,
        },
      },
      update: {
        title: pr.title,
        description: pr.description,
        state: pr.state,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        baseSha: pr.baseSha,
        headSha: pr.headSha,
        isDraft: pr.isDraft,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFilesCount: pr.changedFilesCount,
        htmlUrl: pr.htmlUrl,
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
      },
      create: {
        workspaceId,
        repositoryId,
        githubPrId: pr.githubPrId,
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
        mergedAt: pr.mergedAt,
        closedAt: pr.closedAt,
      },
    });

    const files = await gateway.listPullRequestFiles(
      ghInstallId,
      repo.ownerLogin,
      repo.name,
      pr.prNumber,
    );

    for (const f of files) {
      await prisma.pullRequestFile.upsert({
        where: {
          workspaceId_pullRequestId_headSha_filePath: {
            workspaceId,
            pullRequestId: savedPr.id,
            headSha: pr.headSha,
            filePath: f.filePath,
          },
        },
        update: {
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          blobSha: f.blobSha,
        },
        create: {
          workspaceId,
          pullRequestId: savedPr.id,
          headSha: pr.headSha,
          filePath: f.filePath,
          previousFilePath: f.previousFilePath,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          blobSha: f.blobSha,
        },
      });
    }
    prSyncedCount += 1;
  }

  await prisma.repository.update({
    where: { id: repositoryId },
    data: { lastSyncedAt: new Date() },
  });

  return {
    branchesSynced: branches.length,
    commitsSynced: commits.length,
    pullRequestsSynced: prSyncedCount,
  };
}

// ============================================================================
// Signed GitHub Webhook Ingestion (Raw Body HMAC-SHA256 + Delivery Dedupe)
// ============================================================================

const SUPPORTED_WEBHOOK_EVENTS = new Set([
  'installation',
  'installation_repositories',
  'pull_request',
  'push',
]);

interface WebhookPayloadShape {
  action?: string;
  installation?: {
    id?: number;
    account?: { login?: string; type?: string };
    target_type?: string;
  };
  repository?: {
    id?: number;
    name?: string;
    full_name?: string;
    owner?: { login?: string };
    default_branch?: string;
    private?: boolean;
    visibility?: string;
    language?: string | null;
    description?: string | null;
  };
  repositories_added?: Array<{ id: number; name: string; full_name: string; private?: boolean }>;
  repositories_removed?: Array<{ id: number; name: string; full_name: string }>;
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    state: string;
    merged?: boolean;
    merged_at?: string | null;
    closed_at?: string | null;
    draft?: boolean;
    additions?: number;
    deletions?: number;
    changed_files?: number;
    html_url?: string | null;
    user?: { login?: string };
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
  };
  ref?: string;
  after?: string;
}

export async function ingestGithubWebhook(
  input: {
    rawBody: string;
    deliveryId: string | null;
    eventName: string | null;
    signature256: string | null;
  },
  ctx: RequestContext,
) {
  if (!input.deliveryId || !input.eventName) {
    throw new ValidationError('Missing required GitHub webhook delivery or event headers');
  }

  const signatureValid = verifyGithubWebhookSignature(input.rawBody, input.signature256);
  if (!signatureValid) {
    await recordAuditEvent({
      action: 'github.webhook.invalid_signature',
      resourceType: 'github_webhook',
      resourceId: input.deliveryId,
      outcome: 'DENIED',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { eventName: input.eventName },
    });
    throw new UnauthorizedError('Invalid GitHub webhook signature', 'INVALID_WEBHOOK_SIGNATURE');
  }

  let payload: WebhookPayloadShape;
  try {
    payload = JSON.parse(input.rawBody) as WebhookPayloadShape;
  } catch {
    throw new ValidationError('Webhook payload must be valid JSON');
  }

  const prisma = getPrisma();

  // Deduplicate using unique GitHub delivery ID
  const existingDelivery = await prisma.githubWebhookEvent.findUnique({
    where: { githubDeliveryId: input.deliveryId },
  });
  if (existingDelivery) {
    return {
      accepted: true,
      deduplicated: true,
      deliveryId: input.deliveryId,
      status: existingDelivery.processingStatus,
      scheduledJobId: null,
    };
  }

  const ghInstallationId = payload.installation?.id ? BigInt(payload.installation.id) : null;
  const ghRepoId = payload.repository?.id ? BigInt(payload.repository.id) : null;

  const installation = ghInstallationId
    ? await prisma.githubInstallation.findUnique({
        where: { githubInstallationId: ghInstallationId },
      })
    : null;

  // Reject events referencing unknown or unauthorized installations
  if (!installation || installation.status === 'REVOKED') {
    await prisma.githubWebhookEvent.create({
      data: {
        workspaceId: installation?.workspaceId ?? null,
        githubDeliveryId: input.deliveryId,
        eventName: input.eventName,
        action: payload.action ?? null,
        githubInstallationId: ghInstallationId,
        githubRepoId: ghRepoId,
        signatureValid: true,
        processingStatus: 'IGNORED',
        payloadJson: payload as Prisma.InputJsonValue,
        errorMessage: 'Unauthorized or revoked GitHub installation',
        processedAt: new Date(),
      },
    });
    throw new ForbiddenError(
      'GitHub installation is not authorized for any active workspace',
      'UNAUTHORIZED_GITHUB_INSTALLATION',
    );
  }

  const workspaceId = installation.workspaceId;

  if (!SUPPORTED_WEBHOOK_EVENTS.has(input.eventName)) {
    await prisma.githubWebhookEvent.create({
      data: {
        workspaceId,
        githubDeliveryId: input.deliveryId,
        eventName: input.eventName,
        action: payload.action ?? null,
        githubInstallationId: ghInstallationId,
        githubRepoId: ghRepoId,
        signatureValid: true,
        processingStatus: 'IGNORED',
        payloadJson: payload as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });
    return {
      accepted: true,
      deduplicated: false,
      deliveryId: input.deliveryId,
      status: 'IGNORED',
      scheduledJobId: null,
    };
  }

  // Persist webhook delivery first
  const webhookEvent = await prisma.githubWebhookEvent.create({
    data: {
      workspaceId,
      githubDeliveryId: input.deliveryId,
      eventName: input.eventName,
      action: payload.action ?? null,
      githubInstallationId: ghInstallationId,
      githubRepoId: ghRepoId,
      signatureValid: true,
      processingStatus: 'RECEIVED',
      payloadJson: payload as Prisma.InputJsonValue,
    },
  });

  let scheduledJobId: string | null = null;

  // Handle installation lifecycle webhooks
  if (input.eventName === 'installation' && payload.action === 'deleted') {
    const now = new Date();
    await prisma.$transaction([
      prisma.githubInstallation.update({
        where: { id: installation.id },
        data: { status: 'REVOKED', revokedAt: now },
      }),
      prisma.repository.updateMany({
        where: { workspaceId, githubInstallationId: installation.id },
        data: { isActive: false, accessRevokedAt: now },
      }),
    ]);
  } else if (input.eventName === 'installation_repositories') {
    if (payload.action === 'removed' && payload.repositories_removed) {
      const removedIds = payload.repositories_removed.map((r) => BigInt(r.id));
      await prisma.repository.updateMany({
        where: { workspaceId, githubRepoId: { in: removedIds } },
        data: { isActive: false, accessRevokedAt: new Date() },
      });
    } else if (payload.action === 'added' && payload.repositories_added) {
      for (const added of payload.repositories_added) {
        const [ownerLogin = installation.accountLogin] = added.full_name.split('/');
        await prisma.repository.upsert({
          where: { workspaceId_githubRepoId: { workspaceId, githubRepoId: BigInt(added.id) } },
          update: { isActive: true, accessRevokedAt: null, githubInstallationId: installation.id },
          create: {
            workspaceId,
            githubInstallationId: installation.id,
            githubRepoId: BigInt(added.id),
            ownerLogin,
            name: added.name,
            fullName: added.full_name,
            visibility: added.private ? 'PRIVATE' : 'PUBLIC',
            isActive: true,
          },
        });
      }
    }
  } else if (input.eventName === 'pull_request' && payload.pull_request && payload.repository?.id) {
    const repo = await prisma.repository.findUnique({
      where: {
        workspaceId_githubRepoId: {
          workspaceId,
          githubRepoId: BigInt(payload.repository.id),
        },
      },
    });

    if (repo && repo.isActive && repo.accessRevokedAt === null) {
      const prPayload = payload.pull_request;
      const prState = prPayload.merged ? 'MERGED' : prPayload.state === 'open' ? 'OPEN' : 'CLOSED';

      const pr = await prisma.pullRequest.upsert({
        where: {
          workspaceId_repositoryId_prNumber: {
            workspaceId,
            repositoryId: repo.id,
            prNumber: prPayload.number,
          },
        },
        update: {
          title: prPayload.title,
          description: prPayload.body ?? null,
          state: prState,
          baseBranch: prPayload.base.ref,
          headBranch: prPayload.head.ref,
          baseSha: prPayload.base.sha,
          headSha: prPayload.head.sha,
          isDraft: Boolean(prPayload.draft),
          additions: prPayload.additions ?? 0,
          deletions: prPayload.deletions ?? 0,
          changedFilesCount: prPayload.changed_files ?? 0,
          htmlUrl: prPayload.html_url ?? null,
          mergedAt: prPayload.merged_at ? new Date(prPayload.merged_at) : null,
          closedAt: prPayload.closed_at ? new Date(prPayload.closed_at) : null,
        },
        create: {
          workspaceId,
          repositoryId: repo.id,
          githubPrId: BigInt(prPayload.id),
          prNumber: prPayload.number,
          title: prPayload.title,
          description: prPayload.body ?? null,
          state: prState,
          authorLogin: prPayload.user?.login ?? 'unknown',
          baseBranch: prPayload.base.ref,
          headBranch: prPayload.head.ref,
          baseSha: prPayload.base.sha,
          headSha: prPayload.head.sha,
          isDraft: Boolean(prPayload.draft),
          additions: prPayload.additions ?? 0,
          deletions: prPayload.deletions ?? 0,
          changedFilesCount: prPayload.changed_files ?? 0,
          htmlUrl: prPayload.html_url ?? null,
          mergedAt: prPayload.merged_at ? new Date(prPayload.merged_at) : null,
          closedAt: prPayload.closed_at ? new Date(prPayload.closed_at) : null,
        },
      });

      if (
        payload.action === 'opened' ||
        payload.action === 'synchronize' ||
        payload.action === 'reopened'
      ) {
        // Supersede older non-published reviews for prior SHAs on synchronize
        if (payload.action === 'synchronize') {
          await prisma.codeReview.updateMany({
            where: {
              workspaceId,
              pullRequestId: pr.id,
              headSha: { not: pr.headSha },
              status: {
                in: ['QUEUED', 'FETCHING_CONTEXT', 'ANALYZING', 'VALIDATING', 'AWAITING_APPROVAL'],
              },
            },
            data: { status: 'SUPERSEDED' },
          });
        }

        const enqueued = await enqueueAnalysisJob({
          workspaceId,
          repositoryId: repo.id,
          jobType: 'PR_REVIEW',
          idempotencyKey: `pr-review:${pr.id}:${pr.headSha}:v1`,
          payload: {
            pullRequestId: pr.id,
            repositoryId: repo.id,
            headSha: pr.headSha,
            policyVersion: 'v1',
          },
        });
        scheduledJobId = enqueued.job.id;
      }
    }
  } else if (input.eventName === 'push' && payload.repository?.id && payload.after) {
    const repo = await prisma.repository.findUnique({
      where: {
        workspaceId_githubRepoId: {
          workspaceId,
          githubRepoId: BigInt(payload.repository.id),
        },
      },
    });
    if (repo && repo.isActive && repo.accessRevokedAt === null) {
      const enqueued = await enqueueAnalysisJob({
        workspaceId,
        repositoryId: repo.id,
        jobType: 'REPO_INDEX',
        idempotencyKey: `repo-index:${repo.id}:${payload.after}`,
        payload: {
          repositoryId: repo.id,
          commitSha: payload.after,
        },
      });
      scheduledJobId = enqueued.job.id;
    }
  }

  await prisma.githubWebhookEvent.update({
    where: { id: webhookEvent.id },
    data: {
      processingStatus: scheduledJobId ? 'QUEUED' : 'PROCESSED',
      processedAt: new Date(),
    },
  });

  await recordAuditEvent({
    workspaceId,
    action: `github.webhook.${input.eventName}`,
    resourceType: 'github_webhook',
    resourceId: input.deliveryId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { action: payload.action ?? null, scheduledJobId },
  });

  return {
    accepted: true,
    deduplicated: false,
    deliveryId: input.deliveryId,
    status: scheduledJobId ? 'QUEUED' : 'PROCESSED',
    scheduledJobId,
  };
}
