import { authenticateRequest } from '@/modules/authorization/application/authz.service';
import { createWorkspaceSchema } from '@/modules/workspaces/domain/schemas';
import {
  createWorkspace,
  listUserWorkspaces,
} from '@/modules/workspaces/application/workspaces.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaces = await listUserWorkspaces(principal.userId);
  return okResponse({ items: workspaces }, ctx.correlationId);
});

export const POST = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const body = await parseJsonBody(request, createWorkspaceSchema);
  const workspace = await createWorkspace(principal.userId, body, ctx);
  return okResponse(workspace, ctx.correlationId, { status: 201 });
});
