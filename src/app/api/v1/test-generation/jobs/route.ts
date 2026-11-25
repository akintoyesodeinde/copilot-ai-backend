import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listTestGenerationJobs } from '@/modules/test-generation/application/test-generation.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const repoParam = ctx.url.searchParams.get('repositoryId');
  const repositoryId = repoParam ? validateUuidParam(repoParam, 'repositoryId') : undefined;
  const items = await listTestGenerationJobs(workspaceId, repositoryId);
  return okResponse({ items }, ctx.correlationId);
});
