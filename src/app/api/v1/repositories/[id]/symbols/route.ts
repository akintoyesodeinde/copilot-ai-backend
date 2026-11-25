import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listRepositorySymbols } from '@/modules/indexing/application/indexing.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const commitSha = ctx.url.searchParams.get('commitSha')?.trim() || undefined;
  const kind = ctx.url.searchParams.get('kind')?.trim() || undefined;
  const search = ctx.url.searchParams.get('search')?.trim() || undefined;

  const result = await listRepositorySymbols(workspaceId, repositoryId, {
    commitSha,
    kind,
    search,
  });
  return okResponse(result, ctx.correlationId);
});
