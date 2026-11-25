import { authenticateRequest } from '@/modules/authorization/application/authz.service';
import { getPlatformAdminOverview } from '@/modules/analytics/application/analytics.service';
import { ForbiddenError } from '@/shared/http/problem-details';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  if (!principal.isPlatformAdmin) {
    throw new ForbiddenError('Platform administrator privileges are required for this endpoint');
  }

  const data = await getPlatformAdminOverview();
  return okResponse(data, ctx.correlationId);
});
