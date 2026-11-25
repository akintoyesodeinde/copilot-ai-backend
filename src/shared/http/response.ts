import { NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import type { PaginationMeta } from '@/shared/http/pagination';
import { CSRF_COOKIE_NAME, REFRESH_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/shared/security/csrf';

export interface ApiResponseEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: PaginationMeta;
  };
}

export function buildCorsHeaders(request: Request): Record<string, string> {
  const env = getEnv();
  const origin = request.headers.get('origin');
  const allowedOrigin = new URL(env.FRONTEND_ORIGIN).origin;

  if (!origin || origin !== allowedOrigin) {
    return {
      Vary: 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Workspace-Id, X-Request-Id',
    'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
    Vary: 'Origin',
  };
}

export function okResponse<T>(
  data: T,
  correlationId: string,
  options?: {
    status?: number;
    pagination?: PaginationMeta;
    headers?: Record<string, string>;
    noStore?: boolean;
  },
): NextResponse<ApiResponseEnvelope<T>> {
  const headers: Record<string, string> = {
    'X-Request-Id': correlationId,
    ...(options?.noStore !== false ? { 'Cache-Control': 'no-store' } : {}),
    ...options?.headers,
  };

  return NextResponse.json(
    {
      data,
      meta: {
        requestId: correlationId,
        timestamp: new Date().toISOString(),
        ...(options?.pagination ? { pagination: options.pagination } : {}),
      },
    },
    { status: options?.status ?? 200, headers },
  );
}

export function setAuthCookies(
  response: NextResponse,
  tokens: {
    sessionToken: string;
    refreshToken: string;
    csrfToken: string;
    sessionExpiresAt: Date;
    refreshExpiresAt: Date;
  },
): void {
  const env = getEnv();
  const domain = env.COOKIE_DOMAIN || undefined;

  response.cookies.set(SESSION_COOKIE_NAME, tokens.sessionToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain,
    expires: tokens.sessionExpiresAt,
  });

  response.cookies.set(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
    domain,
    expires: tokens.refreshExpiresAt,
  });

  response.cookies.set(CSRF_COOKIE_NAME, tokens.csrfToken, {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain,
    expires: tokens.sessionExpiresAt,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  const env = getEnv();
  const domain = env.COOKIE_DOMAIN || undefined;

  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain,
    expires: new Date(0),
  });

  response.cookies.set(REFRESH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
    domain,
    expires: new Date(0),
  });

  response.cookies.set(CSRF_COOKIE_NAME, '', {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    domain,
    expires: new Date(0),
  });
}
