import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { updateGeneratedTestApproval } from '@/modules/test-generation/application/test-generation.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const approvalSchema = z.object({
  approvalStatus: z.enum(['APPROVED', 'REJECTED']),
});

export const PATCH = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const generatedTestId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, approvalSchema);
  const data = await updateGeneratedTestApproval({
    workspaceId,
    generatedTestId,
    approvalStatus: body.approvalStatus,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(data, ctx.correlationId);
});
