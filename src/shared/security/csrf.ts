import { getEnv } from '@/config/env';
import { ForbiddenError } from '@/shared/http/problem-details';
import { sha256Hex, timingSafeEqualHex } from '@/shared/security/tokens';

export const CSRF_COOKIE_NAME = 'cp_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const SESSION_COOKIE_NAME = 'cp_session';
export const REFRESH_COOKIE_NAME = 'cp_refresh';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function verifyRequestOrigin(request: Request): void {
  const env = getEnv();
  const allowedOrigins = new Set([
    new URL(env.FRONTEND_ORIGIN).origin,
    new URL(env.APP_URL).origin,
  ]);

  const origin = request.headers.get('origin');
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      throw new ForbiddenError(
        'Origin not allowed for state-changing request',
        'CSRF_ORIGIN_INVALID',
      );
    }
    return;
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowedOrigins.has(refOrigin)) {
        throw new ForbiddenError(
          'Referer not allowed for state-changing request',
          'CSRF_REFERER_INVALID',
        );
      }
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw error;
      }
      throw new ForbiddenError('Malformed referer header', 'CSRF_REFERER_INVALID');
    }
  }
}

export function verifyCsrfToken(request: Request, expectedCsrfTokenHash: string): void {
  if (!isMutatingMethod(request.method)) {
    return;
  }

  verifyRequestOrigin(request);

  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!headerToken || headerToken.length < 16) {
    throw new ForbiddenError('Missing or invalid CSRF token header', 'CSRF_TOKEN_MISSING');
  }

  const actualHash = sha256Hex(headerToken);
  if (!timingSafeEqualHex(actualHash, expectedCsrfTokenHash)) {
    throw new ForbiddenError('CSRF token mismatch', 'CSRF_TOKEN_MISMATCH');
  }
}
