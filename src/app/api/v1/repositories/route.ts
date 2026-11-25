import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspaceRepositories } from '@/modules/repositories/application/repositories.service';
import { parsePaginationParams } from '@/shared/http/pagination';
import { ValidationError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const ALLOWED_VISIBILITIES = new Set(['PUBLIC', 'PRIVATE', 'INTERNAL']);

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const pagination = parsePaginationParams(ctx.url, 20, 100);
  const search = ctx.url.searchParams.get('search')?.trim() || undefined;
  const language = ctx.url.searchParams.get('language')?.trim() || undefined;
  const rawVisibility = ctx.url.searchParams.get('visibility')?.trim().toUpperCase();

  let visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL' | undefined;
  if (rawVisibility) {
    if (!ALLOWED_VISIBILITIES.has(rawVisibility)) {
      throw new ValidationError('Invalid visibility filter', [
        { field: 'visibility', message: 'Must be one of PUBLIC, PRIVATE, INTERNAL' },
      ]);
    }
    visibility = rawVisibility as 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  }

  const result = await listWorkspaceRepositories(workspaceId, pagination, {
    search,
    language,
    visibility,
  });

  return okResponse({ items: result.items }, ctx.correlationId, {
    pagination: result.pagination,
  });
});
