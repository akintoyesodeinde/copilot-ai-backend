import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import {
  listRepositorySecurityScans,
  scheduleSecurityScan,
} from '@/modules/security/application/security.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const triggerScanSchema = z.object({
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, 'commitSha must be a 40-character hexadecimal Git SHA')
    .optional(),
});

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const items = await listRepositorySecurityScans(workspaceId, repositoryId);
  return okResponse({ items }, ctx.correlationId);
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, triggerScanSchema);
  const result = await scheduleSecurityScan({
    workspaceId,
    repositoryId,
    commitSha: body.commitSha,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(result, ctx.correlationId, { status: 202 });
});
