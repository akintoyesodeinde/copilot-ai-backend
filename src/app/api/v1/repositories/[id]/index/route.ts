import { z } from 'zod';
import { getPrisma } from '@/shared/database/prisma';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { enqueueAnalysisJob } from '@/modules/jobs/application/job-queue.service';
import { NotFoundError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const indexRepoSchema = z.object({
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, 'commitSha must be a 40-character hexadecimal Git SHA')
    .optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, indexRepoSchema);
  const repo = await getPrisma().repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    include: { branches: { where: { isDefault: true }, take: 1 } },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access revoked', 'REPOSITORY_NOT_FOUND');
  }

  const commitSha =
    body.commitSha ?? repo.branches[0]?.headSha ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345601';

  const enqueued = await enqueueAnalysisJob({
    workspaceId,
    repositoryId,
    jobType: 'REPO_INDEX',
    idempotencyKey: `repo-index:${repositoryId}:${commitSha}`,
    createdByUserId: principal.userId,
    payload: { repositoryId, commitSha },
  });

  return okResponse(
    {
      jobId: enqueued.job.id,
      jobType: enqueued.job.jobType,
      commitSha,
      status: enqueued.job.status,
      deduplicated: enqueued.deduplicated,
    },
    ctx.correlationId,
    { status: 202 },
  );
});
