import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import {
  createConversation,
  listConversations,
} from '@/modules/assistant/application/assistant.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const createConvSchema = z.object({
  repositoryId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(200).optional(),
});

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const items = await listConversations(workspaceId, principal.userId);
  return okResponse({ items }, ctx.correlationId);
});

export const POST = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, createConvSchema);
  const conv = await createConversation({
    workspaceId,
    userId: principal.userId,
    repositoryId: body.repositoryId ?? null,
    title: body.title,
  });

  return okResponse(conv, ctx.correlationId, { status: 201 });
});
