import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { schedulePullRequestReview } from '@/modules/reviews/application/review-engine.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const scheduleReviewSchema = z.object({
  policyVersion: z.string().trim().min(1).max(32).optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const pullRequestId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, scheduleReviewSchema);
  const scheduled = await schedulePullRequestReview(
    workspaceId,
    pullRequestId,
    principal.userId,
    ctx,
    body.policyVersion ?? 'v1',
  );

  return okResponse(scheduled, ctx.correlationId, { status: 202 });
});
