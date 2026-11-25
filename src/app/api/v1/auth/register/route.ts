import { registerSchema } from '@/modules/auth/domain/schemas';
import { registerUser } from '@/modules/auth/application/auth.service';
import { okResponse, setAuthCookies } from '@/shared/http/response';
import { handleOptionsPreflight, parseJsonBody, withApiHandler } from '@/shared/http/route-handler';
import { verifyRequestOrigin } from '@/shared/security/csrf';

export const OPTIONS = handleOptionsPreflight;

export const POST = withApiHandler(async (request, ctx) => {
  verifyRequestOrigin(request);
  const body = await parseJsonBody(request, registerSchema);
  const result = await registerUser(body, ctx);

  const response = okResponse(
    {
      user: result.user,
      workspaces: result.workspaces,
      csrfToken: result.csrfToken,
    },
    ctx.correlationId,
    { status: 201 },
  );

  setAuthCookies(response, result.tokens);
  return response;
});
