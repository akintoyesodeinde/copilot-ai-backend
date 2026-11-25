import { handleGithubInstallCallback } from '@/modules/github/application/github.service';
import { okResponse } from '@/shared/http/response';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (_request, ctx) => {
  const installationIdRaw = ctx.url.searchParams.get('installation_id');
  const state = ctx.url.searchParams.get('state');
  const result = await handleGithubInstallCallback({ installationIdRaw, state }, ctx);
  return okResponse(result, ctx.correlationId, { status: 201 });
});
