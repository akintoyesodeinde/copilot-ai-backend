import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import {
  getWorkspaceVulnerabilityById,
  triageVulnerability,
} from '@/modules/security/application/security.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const triageSchema = z.object({
  status: z.enum(['OPEN', 'TRIAGED', 'FALSE_POSITIVE', 'FIXED']),
});

export const GET = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const vulnerabilityId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_READ, ctx);

  const data = await getWorkspaceVulnerabilityById(workspaceId, vulnerabilityId);
  return okResponse(data, ctx.correlationId);
});

export const PATCH = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const vulnerabilityId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, triageSchema);
  const data = await triageVulnerability({
    workspaceId,
    vulnerabilityId,
    status: body.status,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(data, ctx.correlationId);
});
