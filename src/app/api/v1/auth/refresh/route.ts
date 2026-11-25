import { refreshUserSession } from '@/modules/auth/application/auth.service';
import { buildProblemResponse } from '@/shared/http/problem-details';
import {
  buildCorsHeaders,
  clearAuthCookies,
  okResponse,
  setAuthCookies,
} from '@/shared/http/response';
import {
  handleOptionsPreflight,
  parseCookieHeader,
  withApiHandler,
} from '@/shared/http/route-handler';
import { REFRESH_COOKIE_NAME, verifyRequestOrigin } from '@/shared/security/csrf';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler(async (request, ctx) => {
  verifyRequestOrigin(request);
  const cookies = parseCookieHeader(request.headers.get('cookie'));

  try {
    const result = await refreshUserSession(cookies[REFRESH_COOKIE_NAME], ctx);
    const response = okResponse(
      {
        user: result.user,
        workspaces: result.workspaces,
        csrfToken: result.csrfToken,
      },
      ctx.correlationId,
      { status: 200 },
    );
    setAuthCookies(response, result.tokens);
    return response;
  } catch (error) {
    const problem = buildProblemResponse(
      error,
      ctx.url.pathname,
      ctx.correlationId,
      buildCorsHeaders(request),
    );
    clearAuthCookies(problem);
    return problem;
  }
});
