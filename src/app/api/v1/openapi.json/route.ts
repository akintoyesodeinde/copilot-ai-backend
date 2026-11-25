import { NextResponse } from 'next/server';
import { getOpenApiSpec } from '@/openapi/spec';
import { handleOptionsPreflight, withApiHandler } from '@/shared/http/route-handler';

export const OPTIONS = handleOptionsPreflight;

export const GET = withApiHandler(async (_request, ctx) => {
  return NextResponse.json(getOpenApiSpec(), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': ctx.correlationId,
      'Cache-Control': 'public, max-age=60',
    },
  });
});
