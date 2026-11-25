import { ingestGithubWebhook } from '@/modules/github/application/github.service';
import { okResponse } from '@/shared/http/response';
import { withApiHandler } from '@/shared/http/route-handler';

/**
 * Signed GitHub Webhook endpoint.
 * Reads the original untouched raw request body before HMAC-SHA256 verification.
 */
export const POST = withApiHandler(async (request, ctx) => {
  const rawBody = await request.text();
  const deliveryId = request.headers.get('x-github-delivery');
  const eventName = request.headers.get('x-github-event');
  const signature256 = request.headers.get('x-hub-signature-256');

  const result = await ingestGithubWebhook({ rawBody, deliveryId, eventName, signature256 }, ctx);

  return okResponse(result, ctx.correlationId, { status: 202 });
});
