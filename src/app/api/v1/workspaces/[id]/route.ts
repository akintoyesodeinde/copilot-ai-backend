import {
  authenticateRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { updateWorkspaceSchema } from '@/modules/workspaces/domain/schemas';
import {
  getWorkspaceDetail,
  updateWorkspace,
} from '@/modules/workspaces/application/workspaces.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const workspaceId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const access = await requireWorkspacePermission(
    principal,
    workspaceId,
    PERMISSIONS.WORKSPACE_READ,
    ctx,
  );
  const detail = await getWorkspaceDetail(workspaceId, access.roleKey);
  return okResponse(detail, ctx.correlationId);
});

export const PATCH = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const workspaceId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const access = await requireWorkspacePermission(
    principal,
    workspaceId,
    PERMISSIONS.WORKSPACE_UPDATE,
    ctx,
  );
  const body = await parseJsonBody(request, updateWorkspaceSchema);
  const updated = await updateWorkspace(workspaceId, principal.userId, access.roleKey, body, ctx);
  return okResponse(updated, ctx.correlationId);
});
