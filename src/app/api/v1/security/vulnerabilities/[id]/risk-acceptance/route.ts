import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { acceptVulnerabilityRisk } from '@/modules/security/application/security.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const riskAcceptanceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Provide a clear risk acceptance rationale (min 10 chars)')
    .max(2000),
  mitigatingControls: z.string().trim().max(2000).optional(),
  expiresAt: z.string().datetime({ message: 'expiresAt must be a valid ISO-8601 datetime string' }),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const vulnerabilityId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.WORKSPACE_UPDATE, ctx);

  const body = await parseJsonBody(request, riskAcceptanceSchema);
  const data = await acceptVulnerabilityRisk({
    workspaceId,
    vulnerabilityId,
    reason: body.reason,
    mitigatingControls: body.mitigatingControls,
    expiresAt: body.expiresAt,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(data, ctx.correlationId, { status: 201 });
});
