import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { rejectReview } from '@/modules/reviews/application/review-engine.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const rejectReviewSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const reviewId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, rejectReviewSchema);
  const result = await rejectReview(workspaceId, reviewId, principal.userId, body.reason, ctx);
  return okResponse(result, ctx.correlationId);
});
