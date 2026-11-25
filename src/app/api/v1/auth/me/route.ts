import { getCurrentUserProfile } from '@/modules/auth/application/auth.service';
import { authenticateRequest } from '@/modules/authorization/application/authz.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request, { skipCsrf: true });
  const profile = await getCurrentUserProfile(principal.userId);
  return okResponse(profile, ctx.correlationId);
});
