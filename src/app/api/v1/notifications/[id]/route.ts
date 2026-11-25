import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { markNotificationRead } from '@/modules/notifications/application/notifications.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const PATCH = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const notificationId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.NOTIFICATION_READ, ctx);

  const notification = await markNotificationRead(workspaceId, principal.userId, notificationId);
  return okResponse(notification, ctx.correlationId);
});
