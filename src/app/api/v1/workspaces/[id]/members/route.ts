import {
  authenticateRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspaceMembers } from '@/modules/workspaces/application/workspaces.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const workspaceId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.MEMBER_READ, ctx);
  const result = await listWorkspaceMembers(workspaceId);
  return okResponse(result, ctx.correlationId);
});
