import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspaceNotifications } from '@/modules/notifications/application/notifications.service';
import { parsePaginationParams } from '@/shared/http/pagination';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.NOTIFICATION_READ, ctx);

  const pagination = parsePaginationParams(ctx.url, 20, 100);
  const unreadOnly = ctx.url.searchParams.get('unreadOnly') === 'true';

  const result = await listWorkspaceNotifications(
    workspaceId,
    principal.userId,
    pagination,
    unreadOnly,
  );

  return okResponse({ items: result.items, unreadCount: result.unreadCount }, ctx.correlationId, {
    pagination: result.pagination,
  });
});
