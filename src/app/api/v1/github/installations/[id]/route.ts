import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { revokeWorkspaceGithubInstallation } from '@/modules/github/application/github.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const DELETE = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const installationId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.WORKSPACE_UPDATE, ctx);

  const result = await revokeWorkspaceGithubInstallation(
    workspaceId,
    installationId,
    principal.userId,
    ctx,
  );
  return okResponse(result, ctx.correlationId);
});
