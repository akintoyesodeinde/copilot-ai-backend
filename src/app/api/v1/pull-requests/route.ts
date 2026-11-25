import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspacePullRequests } from '@/modules/reviews/application/review-engine.service';
import { parsePaginationParams } from '@/shared/http/pagination';
import { ValidationError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const VALID_STATES = new Set(['OPEN', 'CLOSED', 'MERGED']);

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const pagination = parsePaginationParams(ctx.url, 20, 100);
  const repositoryId = ctx.url.searchParams.get('repositoryId')?.trim() || undefined;
  const rawState = ctx.url.searchParams.get('state')?.trim().toUpperCase();

  let state: 'OPEN' | 'CLOSED' | 'MERGED' | undefined;
  if (rawState) {
    if (!VALID_STATES.has(rawState)) {
      throw new ValidationError('Invalid pull request state filter', [
        { field: 'state', message: 'Must be OPEN, CLOSED, or MERGED' },
      ]);
    }
    state = rawState as 'OPEN' | 'CLOSED' | 'MERGED';
  }

  const result = await listWorkspacePullRequests(workspaceId, pagination, {
    repositoryId,
    state,
  });

  return okResponse({ items: result.items }, ctx.correlationId, {
    pagination: result.pagination,
  });
});
