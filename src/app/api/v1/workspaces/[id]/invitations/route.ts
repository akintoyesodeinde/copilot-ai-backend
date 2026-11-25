import {
  authenticateRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { createInvitationSchema } from '@/modules/workspaces/domain/schemas';
import { createWorkspaceInvitation } from '@/modules/workspaces/application/workspaces.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const workspaceId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.MEMBER_INVITE, ctx);
  const body = await parseJsonBody(request, createInvitationSchema);
  const invitation = await createWorkspaceInvitation(workspaceId, principal.userId, body, ctx);
  return okResponse(invitation, ctx.correlationId, { status: 201 });
});
