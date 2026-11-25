import {
  authenticateRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { updateMemberSchema } from '@/modules/workspaces/domain/schemas';
import { updateWorkspaceMember } from '@/modules/workspaces/application/workspaces.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const PATCH = withApiHandler<{ id: string; memberId: string }>(
  async (request, ctx, params) => {
    const workspaceId = validateUuidParam(params.id, 'id');
    const memberId = validateUuidParam(params.memberId, 'memberId');
    const principal = await authenticateRequest(request);
    await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.MEMBER_UPDATE, ctx);
    const body = await parseJsonBody(request, updateMemberSchema);
    const updated = await updateWorkspaceMember(workspaceId, memberId, principal.userId, body, ctx);
    return okResponse(updated, ctx.correlationId);
  },
);
