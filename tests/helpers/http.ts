import type { NextResponse } from 'next/server';

export interface CookieJar {
  session?: string;
  refresh?: string;
  csrf?: string;
}

export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function extractCookies(response: NextResponse): CookieJar {
  const jar: CookieJar = {};
  const setCookies = response.headers.getSetCookie();
  for (const header of setCookies) {
    const [pair] = header.split(';');
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
    if (name === 'cp_session') jar.session = val;
    if (name === 'cp_refresh') jar.refresh = val;
    if (name === 'cp_csrf') jar.csrf = val;
  }
  return jar;
}

export function cookieHeaderFromJar(jar: CookieJar): string {
  const parts: string[] = [];
  if (jar.session) parts.push(`cp_session=${encodeURIComponent(jar.session)}`);
  if (jar.refresh) parts.push(`cp_refresh=${encodeURIComponent(jar.refresh)}`);
  if (jar.csrf) parts.push(`cp_csrf=${encodeURIComponent(jar.csrf)}`);
  return parts.join('; ');
}

export function buildRequest(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    jar?: CookieJar;
    workspaceId?: string;
    origin?: string | null;
    csrfOverride?: string | null;
    extraHeaders?: Record<string, string>;
  },
): Request {
  const method = options?.method ?? 'GET';
  const headers = new Headers(options?.extraHeaders);
  headers.set('user-agent', 'codepilot-vitest/1.0');

  if (options?.origin !== null) {
    headers.set('origin', options?.origin ?? 'http://localhost:3000');
  }

  if (options?.jar) {
    const cookieHeader = cookieHeaderFromJar(options.jar);
    if (cookieHeader) {
      headers.set('cookie', cookieHeader);
    }
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const csrf = options.csrfOverride !== undefined ? options.csrfOverride : options.jar.csrf;
      if (csrf) {
        headers.set('x-csrf-token', csrf);
      }
    }
  } else if (options?.csrfOverride) {
    headers.set('x-csrf-token', options.csrfOverride);
  }

  if (options?.workspaceId) {
    headers.set('x-workspace-id', options.workspaceId);
  }

  let body: string | undefined;
  if (options?.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  return new Request(`http://localhost:4000${path}`, {
    method,
    headers,
    body,
  });
}
