import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { postConversationMessage } from '@/modules/assistant/application/assistant.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const messageSchema = z.object({
  content: z.string().trim().min(2, 'Message cannot be empty').max(6000),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const conversationId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, messageSchema);
  const data = await postConversationMessage({
    workspaceId,
    conversationId,
    userId: principal.userId,
    content: body.content,
    correlationId: ctx.correlationId,
  });

  return okResponse(data, ctx.correlationId, { status: 201 });
});
