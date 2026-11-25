import crypto from 'node:crypto';
import { getEnv } from '@/config/env';
import { getPrisma } from '@/shared/database/prisma';
import { ConflictError, ForbiddenError, UnauthorizedError } from '@/shared/http/problem-details';
import type { RequestContext } from '@/shared/http/route-handler';
import { hashPassword, verifyPassword } from '@/shared/security/password';
import { enforceRateLimit } from '@/shared/security/rate-limit';
import { generateOpaqueToken, sha256Hex } from '@/shared/security/tokens';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import { getPermissionsForRole } from '@/modules/authorization/domain/rbac';
import type { LoginInput, RegisterInput } from '@/modules/auth/domain/schemas';

export interface AuthUserDto {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthWorkspaceSummaryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  planTier: string;
  roleKey: string;
  permissions: string[];
}

export interface IssuedSessionTokens {
  sessionToken: string;
  refreshToken: string;
  csrfToken: string;
  sessionExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface AuthSessionResult {
  user: AuthUserDto;
  workspaces: AuthWorkspaceSummaryDto[];
  csrfToken: string;
  tokens: IssuedSessionTokens;
}

// Pre-computed dummy Argon2id-format hash used only to avoid short-circuiting unknown emails
let dummyHashPromise: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('CodePilot!DummyTimingGuard2026');
  }
  return dummyHashPromise;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function createSessionWithRefreshToken(
  userId: string,
  ctx: RequestContext,
): Promise<IssuedSessionTokens> {
  const env = getEnv();
  const prisma = getPrisma();

  const sessionToken = generateOpaqueToken(32);
  const refreshToken = generateOpaqueToken(32);
  const csrfToken = generateOpaqueToken(24);

  const now = Date.now();
  const sessionExpiresAt = new Date(now + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const refreshExpiresAt = new Date(now + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const familyId = crypto.randomUUID();

  await prisma.$transaction(
    async (tx) => {
      const session = await tx.session.create({
        data: {
          userId,
          sessionTokenHash: sha256Hex(sessionToken),
          csrfTokenHash: sha256Hex(csrfToken),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          expiresAt: sessionExpiresAt,
        },
      });

      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          userId,
          tokenHash: sha256Hex(refreshToken),
          familyId,
          expiresAt: refreshExpiresAt,
        },
      });
    },
    { maxWait: 15_000, timeout: 25_000 },
  );

  return {
    sessionToken,
    refreshToken,
    csrfToken,
    sessionExpiresAt,
    refreshExpiresAt,
  };
}

export async function getUserWorkspaceSummaries(
  userId: string,
): Promise<AuthWorkspaceSummaryDto[]> {
  const prisma = getPrisma();
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      workspace: {
        archivedAt: null,
      },
    },
    include: {
      workspace: true,
    },
    orderBy: {
      joinedAt: 'asc',
    },
  });

  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
    description: membership.workspace.description,
    planTier: membership.workspace.planTier,
    roleKey: membership.roleKey,
    permissions: getPermissionsForRole(membership.roleKey),
  }));
}

export async function registerUser(
  input: RegisterInput,
  ctx: RequestContext,
): Promise<AuthSessionResult> {
  const env = getEnv();
  const email = normalizeEmail(input.email);

  enforceRateLimit({
    key: `register:${ctx.ipAddress ?? 'local'}`,
    limit: env.RATE_LIMIT_REGISTER_MAX,
    windowMs: env.RATE_LIMIT_REGISTER_WINDOW_MS,
  });

  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: input.fullName.trim(),
      lastLoginAt: now,
    },
  });

  const tokens = await createSessionWithRefreshToken(user.id, ctx);

  await recordAuditEvent({
    actorUserId: user.id,
    action: 'auth.register',
    resourceType: 'user',
    resourceId: user.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isPlatformAdmin: user.isPlatformAdmin,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    workspaces: [],
    csrfToken: tokens.csrfToken,
    tokens,
  };
}

export async function loginUser(
  input: LoginInput,
  ctx: RequestContext,
): Promise<AuthSessionResult> {
  const env = getEnv();
  const email = normalizeEmail(input.email);

  enforceRateLimit({
    key: `login:${ctx.ipAddress ?? 'local'}:${email}`,
    limit: env.RATE_LIMIT_LOGIN_MAX,
    windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  });

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const dummyHash = await getDummyPasswordHash();
    await verifyPassword(dummyHash, input.password);
    await recordAuditEvent({
      action: 'auth.login_failed',
      resourceType: 'user',
      outcome: 'FAILURE',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason: 'INVALID_CREDENTIALS' },
    });
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    await recordAuditEvent({
      actorUserId: user.id,
      action: 'auth.login_failed',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'FAILURE',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason: 'INVALID_CREDENTIALS' },
    });
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    await recordAuditEvent({
      actorUserId: user.id,
      action: 'auth.login_failed',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'DENIED',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { reason: 'ACCOUNT_INACTIVE' },
    });
    throw new ForbiddenError('Account is deactivated', 'ACCOUNT_INACTIVE');
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now },
  });

  const tokens = await createSessionWithRefreshToken(user.id, ctx);
  const workspaces = await getUserWorkspaceSummaries(user.id);

  await recordAuditEvent({
    actorUserId: user.id,
    action: 'auth.login',
    resourceType: 'user',
    resourceId: user.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isPlatformAdmin: user.isPlatformAdmin,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: now.toISOString(),
    },
    workspaces,
    csrfToken: tokens.csrfToken,
    tokens,
  };
}

export async function refreshUserSession(
  rawRefreshToken: string | undefined,
  ctx: RequestContext,
): Promise<AuthSessionResult> {
  if (!rawRefreshToken || rawRefreshToken.length < 16) {
    throw new UnauthorizedError('Refresh token is missing', 'REFRESH_TOKEN_MISSING');
  }

  const env = getEnv();
  const prisma = getPrisma();
  const tokenHash = sha256Hex(rawRefreshToken);

  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      session: true,
      user: true,
    },
  });

  if (!existingToken) {
    throw new UnauthorizedError('Refresh token is invalid', 'REFRESH_TOKEN_INVALID');
  }

  // Refresh token reuse detection: revoke the whole token family and session
  if (existingToken.revokedAt !== null || existingToken.replacedById !== null) {
    const now = new Date();
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: { familyId: existingToken.familyId, revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.session.updateMany({
        where: { id: existingToken.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await recordAuditEvent({
      actorUserId: existingToken.userId,
      action: 'auth.refresh_token_reuse_detected',
      resourceType: 'session',
      resourceId: existingToken.sessionId,
      outcome: 'DENIED',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { familyId: existingToken.familyId },
    });

    throw new UnauthorizedError(
      'Refresh token reuse detected. Session has been revoked.',
      'REFRESH_TOKEN_REUSED',
    );
  }

  const now = new Date();
  if (existingToken.expiresAt <= now || existingToken.session.revokedAt !== null) {
    throw new UnauthorizedError('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
  }

  if (!existingToken.user.isActive) {
    throw new ForbiddenError('Account is deactivated', 'ACCOUNT_INACTIVE');
  }

  const nextSessionToken = generateOpaqueToken(32);
  const nextRefreshToken = generateOpaqueToken(32);
  const nextCsrfToken = generateOpaqueToken(24);
  const sessionExpiresAt = new Date(now.getTime() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const refreshExpiresAt = new Date(
    now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: existingToken.sessionId },
      data: {
        sessionTokenHash: sha256Hex(nextSessionToken),
        csrfTokenHash: sha256Hex(nextCsrfToken),
        expiresAt: sessionExpiresAt,
        lastActiveAt: now,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    const replacement = await tx.refreshToken.create({
      data: {
        sessionId: existingToken.sessionId,
        userId: existingToken.userId,
        tokenHash: sha256Hex(nextRefreshToken),
        familyId: existingToken.familyId,
        expiresAt: refreshExpiresAt,
      },
    });

    await tx.refreshToken.update({
      where: { id: existingToken.id },
      data: {
        revokedAt: now,
        replacedById: replacement.id,
      },
    });
  });

  const workspaces = await getUserWorkspaceSummaries(existingToken.userId);

  await recordAuditEvent({
    actorUserId: existingToken.userId,
    action: 'auth.refresh',
    resourceType: 'session',
    resourceId: existingToken.sessionId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return {
    user: {
      id: existingToken.user.id,
      email: existingToken.user.email,
      fullName: existingToken.user.fullName,
      avatarUrl: existingToken.user.avatarUrl,
      isPlatformAdmin: existingToken.user.isPlatformAdmin,
      createdAt: existingToken.user.createdAt.toISOString(),
      lastLoginAt: existingToken.user.lastLoginAt?.toISOString() ?? null,
    },
    workspaces,
    csrfToken: nextCsrfToken,
    tokens: {
      sessionToken: nextSessionToken,
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
      sessionExpiresAt,
      refreshExpiresAt,
    },
  };
}

export async function logoutSession(
  sessionId: string,
  userId: string,
  ctx: RequestContext,
): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();

  await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: now },
    }),
    prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  await recordAuditEvent({
    actorUserId: userId,
    action: 'auth.logout',
    resourceType: 'session',
    resourceId: sessionId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getCurrentUserProfile(userId: string): Promise<{
  user: AuthUserDto;
  workspaces: AuthWorkspaceSummaryDto[];
}> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }

  const workspaces = await getUserWorkspaceSummaries(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isPlatformAdmin: user.isPlatformAdmin,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    workspaces,
  };
}
