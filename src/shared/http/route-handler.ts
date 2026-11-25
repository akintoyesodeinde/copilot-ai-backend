import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getEnv } from '@/config/env';
import { createRequestLogger } from '@/shared/logging/logger';
import {
  AppError,
  PayloadTooLargeError,
  ValidationError,
  buildProblemResponse,
  fromZodError,
} from '@/shared/http/problem-details';
import { buildCorsHeaders } from '@/shared/http/response';

export interface RequestContext {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  url: URL;
}

export function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first.slice(0, 64);
    }
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp ? realIp.slice(0, 64) : null;
}

export function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }
  return cookies;
}

export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const env = getEnv();
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > env.MAX_REQUEST_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
  }

  const rawText = await request.text();
  if (Buffer.byteLength(rawText, 'utf8') > env.MAX_REQUEST_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  let json: unknown;
  try {
    json = rawText.length === 0 ? {} : JSON.parse(rawText);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw fromZodError(result.error);
  }
  return result.data;
}

export function handleOptionsPreflight(request: Request): NextResponse {
  const corsHeaders = buildCorsHeaders(request);
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function withApiHandler<TParams = Record<string, string>>(
  handler: (request: Request, context: RequestContext, params: TParams) => Promise<NextResponse>,
) {
  return async (
    request: Request,
    routeContext?: { params?: Promise<TParams> | TParams },
  ): Promise<NextResponse> => {
    const incomingId = request.headers.get('x-request-id')?.trim();
    const correlationId =
      incomingId && /^[A-Za-z0-9_-]{8,64}$/.test(incomingId) ? incomingId : crypto.randomUUID();
    const url = new URL(request.url);
    const corsHeaders = buildCorsHeaders(request);
    const logger = createRequestLogger(correlationId);
    const startMs = Date.now();

    const ctx: RequestContext = {
      correlationId,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      url,
    };

    try {
      const resolvedParams = routeContext?.params ? await routeContext.params : ({} as TParams);

      const response = await handler(request, ctx, resolvedParams);
      for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
      }
      response.headers.set('X-Request-Id', correlationId);

      logger.info(
        {
          method: request.method,
          path: url.pathname,
          status: response.status,
          durationMs: Date.now() - startMs,
        },
        'HTTP request completed',
      );

      return response;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      if (error instanceof AppError && error.status < 500) {
        logger.warn(
          {
            method: request.method,
            path: url.pathname,
            status: error.status,
            code: error.code,
            durationMs,
          },
          error.message,
        );
      } else {
        logger.error(
          {
            err: error,
            method: request.method,
            path: url.pathname,
            durationMs,
          },
          'Unhandled HTTP request error',
        );
      }

      return buildProblemResponse(error, url.pathname, correlationId, corsHeaders);
    }
  };
}
