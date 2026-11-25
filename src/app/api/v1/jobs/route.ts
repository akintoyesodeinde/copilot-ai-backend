import type { AnalysisJobType } from '@/generated/prisma/client';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { listWorkspaceJobs } from '@/modules/jobs/application/job-queue.service';
import { parsePaginationParams } from '@/shared/http/pagination';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const pagination = parsePaginationParams(ctx.url, 25, 100);
  const jobType = (ctx.url.searchParams.get('jobType')?.trim().toUpperCase() || undefined) as
    AnalysisJobType | undefined;
  const status = ctx.url.searchParams.get('status')?.trim().toUpperCase() || undefined;

  const result = await listWorkspaceJobs(workspaceId, pagination, { jobType, status });
  return okResponse({ items: result.items }, ctx.correlationId, {
    pagination: result.pagination,
  });
});
