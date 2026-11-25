import { getLivenessStatus } from '@/modules/health/application/health.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (_request, ctx) => {
  return okResponse(getLivenessStatus(), ctx.correlationId);
});
