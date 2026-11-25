import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { explainRepositoryCode } from '@/modules/assistant/application/assistant.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const explainSchema = z.object({
  repositoryId: z.string().uuid(),
  filePath: z.string().trim().min(1).max(400),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  question: z.string().trim().max(1000).optional(),
});

export const POST = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const body = await parseJsonBody(request, explainSchema);
  const data = await explainRepositoryCode({
    workspaceId,
    repositoryId: body.repositoryId,
    filePath: body.filePath,
    startLine: body.startLine,
    endLine: body.endLine,
    question: body.question,
  });

  return okResponse(data, ctx.correlationId);
});
