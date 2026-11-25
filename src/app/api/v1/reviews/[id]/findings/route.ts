import type { FindingSeverity } from '@/generated/prisma/client';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listReviewFindings } from '@/modules/reviews/application/review-engine.service';
import { ValidationError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const reviewId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const rawSeverity = ctx.url.searchParams.get('severity')?.trim().toUpperCase();
  let severity: FindingSeverity | undefined;
  if (rawSeverity) {
    if (!VALID_SEVERITIES.has(rawSeverity)) {
      throw new ValidationError('Invalid severity filter', [
        { field: 'severity', message: 'Must be CRITICAL, HIGH, MEDIUM, LOW, or INFO' },
      ]);
    }
    severity = rawSeverity as FindingSeverity;
  }

  const items = await listReviewFindings(workspaceId, reviewId, severity);
  return okResponse({ items }, ctx.correlationId);
});
