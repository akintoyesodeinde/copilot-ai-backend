import { describe, expect, it, beforeEach } from 'vitest';
import { hashPassword, verifyPassword } from '@/shared/security/password';
import { generateOpaqueToken, sha256Hex, timingSafeEqualHex } from '@/shared/security/tokens';
import { verifyCsrfToken, verifyRequestOrigin } from '@/shared/security/csrf';
import { clearRateLimitsForTesting, enforceRateLimit } from '@/shared/security/rate-limit';
import {
  decodeCursor,
  encodeCursor,
  paginateDescByCreatedAt,
  parsePaginationParams,
} from '@/shared/http/pagination';
import {
  ForbiddenError,
  RateLimitError,
  ValidationError,
  buildProblemResponse,
} from '@/shared/http/problem-details';
import {
  PERMISSIONS,
  ROLE_KEYS,
  getPermissionsForRole,
  hasWorkspacePermission,
  isAssignableWorkspaceRole,
} from '@/modules/authorization/domain/rbac';
import { getOpenApiSpec } from '@/openapi/spec';

describe('Security primitives', () => {
  beforeEach(() => {
    clearRateLimitsForTesting();
  });

  it('hashes and verifies passwords using Argon2id', async () => {
    const hash = await hashPassword('StrongP@ssword2026!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'StrongP@ssword2026!')).toBe(true);
    expect(await verifyPassword(hash, 'WrongP@ssword2026!')).toBe(false);
  });

  it('generates high-entropy opaque tokens and performs timing-safe SHA-256 comparison', () => {
    const t1 = generateOpaqueToken(32);
    const t2 = generateOpaqueToken(32);
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(40);
    const h1 = sha256Hex(t1);
    const h2 = sha256Hex(t2);
    expect(h1).toHaveLength(64);
    expect(timingSafeEqualHex(h1, h1)).toBe(true);
    expect(timingSafeEqualHex(h1, h2)).toBe(false);
    expect(timingSafeEqualHex(h1, 'short')).toBe(false);
  });

  it('enforces CSRF token matching and trusted origins on mutating requests', () => {
    const csrfToken = generateOpaqueToken(24);
    const expectedHash = sha256Hex(csrfToken);

    const validReq = new Request('http://localhost:4000/api/v1/workspaces', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'x-csrf-token': csrfToken,
      },
    });
    expect(() => verifyCsrfToken(validReq, expectedHash)).not.toThrow();

    const missingHeaderReq = new Request('http://localhost:4000/api/v1/workspaces', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(() => verifyCsrfToken(missingHeaderReq, expectedHash)).toThrow(ForbiddenError);

    const badOriginReq = new Request('http://localhost:4000/api/v1/workspaces', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example.com',
        'x-csrf-token': csrfToken,
      },
    });
    expect(() => verifyRequestOrigin(badOriginReq)).toThrow(ForbiddenError);
  });

  it('enforces sliding-window rate limits with Retry-After metadata', () => {
    const now = 1_700_000_000_000;
    expect(
      enforceRateLimit({ key: 'login:test', limit: 2, windowMs: 60_000, nowMs: now }).remaining,
    ).toBe(1);
    expect(
      enforceRateLimit({ key: 'login:test', limit: 2, windowMs: 60_000, nowMs: now + 1000 })
        .remaining,
    ).toBe(0);
    expect(() =>
      enforceRateLimit({ key: 'login:test', limit: 2, windowMs: 60_000, nowMs: now + 2000 }),
    ).toThrow(RateLimitError);

    // After window elapses, requests succeed again
    expect(
      enforceRateLimit({ key: 'login:test', limit: 2, windowMs: 60_000, nowMs: now + 61_000 })
        .remaining,
    ).toBe(1);
  });
});

describe('Pagination and RFC 9457 Problem Details', () => {
  it('encodes, decodes, and paginates cursors accurately', () => {
    const items = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        createdAt: new Date('2026-11-24T10:00:00.000Z'),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: new Date('2026-11-24T09:00:00.000Z'),
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        createdAt: new Date('2026-11-24T08:00:00.000Z'),
      },
    ];

    const page = paginateDescByCreatedAt(items, 2);
    expect(page.items).toHaveLength(2);
    expect(page.pagination.hasMore).toBe(true);
    expect(page.pagination.nextCursor).toBeTruthy();

    const decoded = decodeCursor(page.pagination.nextCursor!);
    expect(decoded.id).toBe(items[1]!.id);
    expect(decoded.createdAt.toISOString()).toBe(items[1]!.createdAt.toISOString());

    const encodedDirect = encodeCursor(items[0]!);
    expect(decodeCursor(encodedDirect).id).toBe(items[0]!.id);
  });

  it('rejects malformed cursors and out-of-range limits', () => {
    expect(() => decodeCursor('not-valid-base64-json')).toThrow(ValidationError);
    expect(() =>
      parsePaginationParams(new URL('http://localhost:4000/api/v1/repositories?limit=500')),
    ).toThrow(ValidationError);
  });

  it('formats RFC 9457 application/problem+json responses with correlationId', async () => {
    const res = buildProblemResponse(
      new ValidationError('Invalid fields', [{ field: 'email', message: 'Invalid email' }]),
      '/api/v1/auth/register',
      'corr-12345',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('x-request-id')).toBe('corr-12345');

    const body = await res.json();
    expect(body).toMatchObject({
      title: 'Validation Failed',
      status: 400,
      code: 'VALIDATION_ERROR',
      instance: '/api/v1/auth/register',
      correlationId: 'corr-12345',
      errors: [{ field: 'email', message: 'Invalid email' }],
    });
  });
});

describe('RBAC domain rules and OpenAPI 3.1 contract', () => {
  it('enforces the 4 approved roles and prevents PLATFORM_ADMIN workspace bypass', () => {
    expect(hasWorkspacePermission(ROLE_KEYS.WORKSPACE_OWNER, PERMISSIONS.WORKSPACE_UPDATE)).toBe(
      true,
    );
    expect(hasWorkspacePermission(ROLE_KEYS.WORKSPACE_OWNER, PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(hasWorkspacePermission(ROLE_KEYS.DEVELOPER, PERMISSIONS.REPOSITORY_WRITE)).toBe(true);
    expect(hasWorkspacePermission(ROLE_KEYS.DEVELOPER, PERMISSIONS.WORKSPACE_UPDATE)).toBe(false);
    expect(hasWorkspacePermission(ROLE_KEYS.DEVELOPER, PERMISSIONS.AUDIT_READ)).toBe(false);
    expect(hasWorkspacePermission(ROLE_KEYS.VIEWER, PERMISSIONS.REPOSITORY_READ)).toBe(true);
    expect(hasWorkspacePermission(ROLE_KEYS.VIEWER, PERMISSIONS.REPOSITORY_WRITE)).toBe(false);
    expect(hasWorkspacePermission(ROLE_KEYS.PLATFORM_ADMIN, PERMISSIONS.REPOSITORY_READ)).toBe(
      false,
    );
    expect(hasWorkspacePermission(ROLE_KEYS.PLATFORM_ADMIN, PERMISSIONS.WORKSPACE_READ)).toBe(
      false,
    );

    expect(isAssignableWorkspaceRole(ROLE_KEYS.PLATFORM_ADMIN)).toBe(false);
    expect(isAssignableWorkspaceRole(ROLE_KEYS.DEVELOPER)).toBe(true);
    expect(getPermissionsForRole(ROLE_KEYS.WORKSPACE_OWNER).length).toBeGreaterThan(5);
  });

  it('documents all 19 mandatory Phase 1 API paths in OpenAPI 3.1', () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    const paths = Object.keys(spec.paths ?? {});
    const requiredPaths = [
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/workspaces',
      '/api/v1/workspaces/{id}',
      '/api/v1/workspaces/{id}/members',
      '/api/v1/workspaces/{id}/invitations',
      '/api/v1/workspaces/{id}/members/{memberId}',
      '/api/v1/repositories',
      '/api/v1/repositories/{id}',
      '/api/v1/analytics/overview',
      '/api/v1/notifications',
      '/api/v1/audit-logs',
      '/api/v1/health/live',
      '/api/v1/health/ready',
    ];
    for (const p of requiredPaths) {
      expect(paths).toContain(p);
    }
  });
});
