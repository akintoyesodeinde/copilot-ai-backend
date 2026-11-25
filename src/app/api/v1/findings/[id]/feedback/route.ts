import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { submitFindingFeedback } from '@/modules/reviews/application/review-engine.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const feedbackSchema = z.object({
  vote: z.enum(['HELPFUL', 'NOT_HELPFUL', 'FALSE_POSITIVE']),
  comment: z.string().trim().max(500).optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const findingId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const body = await parseJsonBody(request, feedbackSchema);
  const result = await submitFindingFeedback(
    workspaceId,
    findingId,
    principal.userId,
    body.vote,
    body.comment,
  );
  return okResponse(result, ctx.correlationId);
});
