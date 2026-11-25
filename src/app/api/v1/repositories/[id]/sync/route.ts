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
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const repo = await getPrisma().repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, isActive: true, accessRevokedAt: true },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found or access revoked', 'REPOSITORY_NOT_FOUND');
  }

  const bucketMinute = Math.floor(Date.now() / 60_000);
  const enqueued = await enqueueAnalysisJob({
    workspaceId,
    repositoryId,
    jobType: 'REPO_SYNC',
    idempotencyKey: `repo-sync:${repositoryId}:${bucketMinute}`,
    createdByUserId: principal.userId,
    payload: { repositoryId },
  });

  return okResponse(
    {
      jobId: enqueued.job.id,
      jobType: enqueued.job.jobType,
      status: enqueued.job.status,
      deduplicated: enqueued.deduplicated,
    },
    ctx.correlationId,
    { status: 202 },
  );
});
