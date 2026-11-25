import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { scheduleArchitectureScan } from '@/modules/architecture/application/architecture.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const layerRuleSchema = z.object({
  name: z.string().min(2).max(120),
  fromLayer: z.string().min(2).max(64),
  forbiddenToLayers: z.array(z.string().min(2).max(64)).min(1),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  rationale: z.string().min(5).max(500),
});

const archScanSchema = z.object({
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, 'commitSha must be a 40-character hexadecimal Git SHA')
    .optional(),
  customRules: z.array(layerRuleSchema).max(20).optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, archScanSchema);
  const result = await scheduleArchitectureScan({
    workspaceId,
    repositoryId,
    commitSha: body.commitSha,
    customRules: body.customRules,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(result, ctx.correlationId, { status: 202 });
});
