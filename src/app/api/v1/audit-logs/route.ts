import { listWorkspaceAuditLogs } from '@/modules/audit/application/audit.service';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { parsePaginationParams } from '@/shared/http/pagination';
import { ValidationError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const ALLOWED_OUTCOMES = new Set(['SUCCESS', 'FAILURE', 'DENIED']);

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.AUDIT_READ, ctx);

  const pagination = parsePaginationParams(ctx.url, 25, 100);
  const action = ctx.url.searchParams.get('action')?.trim() || undefined;
  const rawOutcome = ctx.url.searchParams.get('outcome')?.trim().toUpperCase();

  let outcome: 'SUCCESS' | 'FAILURE' | 'DENIED' | undefined;
  if (rawOutcome) {
    if (!ALLOWED_OUTCOMES.has(rawOutcome)) {
      throw new ValidationError('Invalid audit outcome filter', [
        { field: 'outcome', message: 'Must be one of SUCCESS, FAILURE, DENIED' },
      ]);
    }
    outcome = rawOutcome as 'SUCCESS' | 'FAILURE' | 'DENIED';
  }

  const result = await listWorkspaceAuditLogs(workspaceId, pagination, { action, outcome });

  return okResponse({ items: result.items }, ctx.correlationId, {
    pagination: result.pagination,
  });
});
