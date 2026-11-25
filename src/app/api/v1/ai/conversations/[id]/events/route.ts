import { NextResponse } from 'next/server';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { getConversationDetail } from '@/modules/assistant/application/assistant.service';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

/**
 * Server-Sent Events (SSE) stream of the latest verified advisory assistant response
 * and citations for a tenant-scoped conversation.
 */
export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const conversationId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const conversation = await getConversationDetail(workspaceId, conversationId, principal.userId);
  const lastAssistant = [...conversation.messages].reverse().find((m) => m.role === 'ASSISTANT');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send('connected', {
        conversationId: conversation.id,
        advisoryOnly: true,
        commitSha: conversation.commitSha,
      });

      if (lastAssistant) {
        const chunks = lastAssistant.content.match(/.{1,120}(\s|$)|\S+/gs) ?? [
          lastAssistant.content,
        ];
        for (const chunk of chunks) {
          send('token', { messageId: lastAssistant.id, delta: chunk });
        }
        send('citations', {
          messageId: lastAssistant.id,
          citations: lastAssistant.citations,
        });
      }

      send('done', { conversationId: conversation.id, messageCount: conversation.messages.length });
      controller.close();
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Correlation-Id': ctx.correlationId,
    },
  });
});
