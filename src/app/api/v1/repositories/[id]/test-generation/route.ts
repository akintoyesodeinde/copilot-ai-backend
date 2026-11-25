import { z } from 'zod';
import {
  authenticateRequest,
  extractWorkspaceIdFromRequest,
  requireWorkspacePermission,
  validateUuidParam,
} from '@/modules/authorization/application/authz.service';
import { PERMISSIONS } from '@/modules/authorization/domain/rbac';
import { scheduleTestGeneration } from '@/modules/test-generation/application/test-generation.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

const testGenSchema = z.object({
  targetFilePath: z.string().trim().min(1).max(400),
  language: z.enum(['typescript', 'javascript', 'python', 'java', 'c_sharp', 'go']).optional(),
  framework: z.string().trim().max(64).optional(),
  testTypes: z
    .array(z.enum(['UNIT', 'INTEGRATION', 'REGRESSION', 'SECURITY']))
    .min(1)
    .max(4)
    .optional(),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, 'commitSha must be a 40-character hexadecimal Git SHA')
    .optional(),
});

export const POST = withApiHandler<{ id: string }>(async (request, ctx, params) => {
  const repositoryId = validateUuidParam(params.id, 'id');
  const principal = await authenticateRequest(request);
  const workspaceId = extractWorkspaceIdFromRequest(request, ctx.url);
  await requireWorkspacePermission(principal, workspaceId, PERMISSIONS.REPOSITORY_WRITE, ctx);

  const body = await parseJsonBody(request, testGenSchema);
  const data = await scheduleTestGeneration({
    workspaceId,
    repositoryId,
    targetFilePath: body.targetFilePath,
    language: body.language,
    framework: body.framework,
    testTypes: body.testTypes,
    commitSha: body.commitSha,
    actorUserId: principal.userId,
    correlationId: ctx.correlationId,
  });

  return okResponse(data, ctx.correlationId, { status: 202 });
});
