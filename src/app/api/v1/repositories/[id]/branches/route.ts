import { getPrisma } from '@/shared/database/prisma';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { NotFoundError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const prisma = getPrisma();
  const repo = await prisma.repository.findUnique({
    where: { workspaceId_id: { workspaceId, id: repositoryId } },
    select: { id: true, isActive: true, accessRevokedAt: true },
  });
  if (!repo || !repo.isActive || repo.accessRevokedAt !== null) {
    throw new NotFoundError('Repository not found in this workspace', 'REPOSITORY_NOT_FOUND');
  }

  const branches = await prisma.repositoryBranch.findMany({
    where: { workspaceId, repositoryId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });

  return okResponse(
    {
      items: branches.map((b) => ({
        id: b.id,
        name: b.name,
        headSha: b.headSha,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
        lastCommitAt: b.lastCommitAt?.toISOString() ?? null,
      })),
    },
    ctx.correlationId,
  );
});
