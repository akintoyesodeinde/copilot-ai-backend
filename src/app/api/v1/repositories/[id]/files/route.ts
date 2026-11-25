import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listRepositoryFiles } from '@/modules/indexing/application/indexing.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const commitSha = ctx.url.searchParams.get('commitSha')?.trim() || undefined;
  const language = ctx.url.searchParams.get('language')?.trim() || undefined;
  const search = ctx.url.searchParams.get('search')?.trim() || undefined;

  const result = await listRepositoryFiles(workspaceId, repositoryId, {
    commitSha,
    language,
    search,
  });
  return okResponse(result, ctx.correlationId);
});
