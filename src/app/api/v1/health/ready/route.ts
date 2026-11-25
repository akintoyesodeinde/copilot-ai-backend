import { getReadinessStatus } from '@/modules/health/application/health.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (_request, ctx) => {
  const readiness = await getReadinessStatus();
  return okResponse(readiness, ctx.correlationId, {
    status: readiness.ready ? 200 : 503,
  });
});
