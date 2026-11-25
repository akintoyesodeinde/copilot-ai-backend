import { logoutSession } from '@/modules/auth/application/auth.service';
import { authenticateRequest } from '@/modules/authorization/application/authz.service';
import { clearAuthCookies, okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler(async (request, ctx) => {
  const principal = await authenticateRequest(request);
  await logoutSession(principal.sessionId, principal.userId, ctx);

  const response = okResponse({ loggedOut: true }, ctx.correlationId, { status: 200 });
  clearAuthCookies(response);
  return response;
});
