import { loginSchema } from '@/modules/auth/domain/schemas';
import { loginUser } from '@/modules/auth/application/auth.service';
import { okResponse, setAuthCookies } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';
import { verifyRequestOrigin } from '@/shared/security/csrf';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler(async (request, ctx) => {
  verifyRequestOrigin(request);
  const body = await parseJsonBody(request, loginSchema);
  const result = await loginUser(body, ctx);

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
});
