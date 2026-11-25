import { z } from 'zod';
import { getPrisma } from '@/shared/database/prisma';
import { ForbiddenError, UnauthorizedError, ValidationError } from '@/shared/http/problem-details';
import { parseCookieHeader, type RequestContext } from '@/shared/http/route-handler';
import { SESSION_COOKIE_NAME, verifyCsrfToken } from '@/shared/security/csrf';
import { sha256Hex } from '@/shared/security/tokens';
import {
  getPermissionsForRole,
  hasWorkspacePermission,
  type PermissionKey,
  type WorkspaceRoleKey,
} from '@/modules/authorization/domain/rbac';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  sessionId: string;
  csrfTokenHash: string;
}

export interface WorkspaceAccessContext {
  workspaceId: string;
  memberId: string;
  roleKey: WorkspaceRoleKey;
  permissions: PermissionKey[];
}

const uuidSchema = z.string().uuid();

export async function authenticateRequest(
  request: Request,
  options?: { skipCsrf?: boolean },
): Promise<AuthenticatedPrincipal> {
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  const rawSessionToken = cookies[SESSION_COOKIE_NAME];

  if (!rawSessionToken || rawSessionToken.length < 16) {
    throw new UnauthorizedError('Authentication session is missing');
  }

  const tokenHash = sha256Hex(rawSessionToken);
  const prisma = getPrisma();

  const session = await prisma.session.findUnique({
    where: { sessionTokenHash: tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          isPlatformAdmin: true,
          isActive: true,
        },
      },
    },
  });

  if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
    throw new UnauthorizedError('Session is invalid or expired', 'SESSION_EXPIRED');
  }

  if (!session.user.isActive) {
    throw new ForbiddenError('Account is deactivated', 'ACCOUNT_INACTIVE');
  }

  if (!options?.skipCsrf) {
    verifyCsrfToken(request, session.csrfTokenHash);
  }

  // Opportunistic lastActiveAt update (non-blocking if concurrent)
  const now = new Date();
  if (now.getTime() - session.lastActiveAt.getTime() > 60_000) {
    void prisma.session
      .update({
        where: { id: session.id },
        data: { lastActiveAt: now },
      })
      .catch(() => undefined);
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    fullName: session.user.fullName,
    avatarUrl: session.user.avatarUrl,
    isPlatformAdmin: session.user.isPlatformAdmin,
    sessionId: session.id,
    csrfTokenHash: session.csrfTokenHash,
  };
}

export function extractWorkspaceIdFromRequest(request: Request, url: URL): string {
  const headerValue = request.headers.get('x-workspace-id')?.trim();
  const queryValue = url.searchParams.get('workspaceId')?.trim();
  const candidate = headerValue || queryValue;

  if (!candidate) {
    throw new ValidationError(
      'A workspaceId query parameter or X-Workspace-Id header is required',
      [{ field: 'workspaceId', message: 'Workspace identifier is required' }],
    );
  }

  const parsed = uuidSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError('Invalid workspace identifier format', [
      { field: 'workspaceId', message: 'Must be a valid UUID' },
    ]);
  }

  return parsed.data;
}

export function validateUuidParam(value: string | undefined, fieldName: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${fieldName} format`, [
      { field: fieldName, message: 'Must be a valid UUID' },
    ]);
  }
  return parsed.data;
}

/**
 * Enforces strict tenant isolation and RBAC.
 * IMPORTANT: Platform Administrators do NOT bypass workspace membership checks,
 * ensuring they cannot automatically inspect private tenant repositories or source data.
 */
export async function requireWorkspacePermission(
  principal: AuthenticatedPrincipal,
  workspaceId: string,
  permission: PermissionKey,
  ctx: RequestContext,
): Promise<WorkspaceAccessContext> {
  const prisma = getPrisma();

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: principal.userId,
      },
    },
    include: {
      workspace: {
        select: {
          id: true,
          archivedAt: true,
        },
      },
    },
  });

  if (!membership || membership.status !== 'ACTIVE' || membership.workspace.archivedAt !== null) {
    await recordAuditEvent({
      workspaceId: null,
      actorUserId: principal.userId,
      action: 'authorization.tenant_access_denied',
      resourceType: 'workspace',
      resourceId: workspaceId,
      outcome: 'DENIED',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        requiredPermission: permission,
        isPlatformAdmin: principal.isPlatformAdmin,
        reason: 'NO_ACTIVE_MEMBERSHIP',
      },
    });
    throw new ForbiddenError('You do not have access to this workspace', 'WORKSPACE_ACCESS_DENIED');
  }

  if (!hasWorkspacePermission(membership.roleKey, permission)) {
    await recordAuditEvent({
      workspaceId,
      actorUserId: principal.userId,
      action: 'authorization.permission_denied',
      resourceType: 'workspace',
      resourceId: workspaceId,
      outcome: 'DENIED',
      correlationId: ctx.correlationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        roleKey: membership.roleKey,
        requiredPermission: permission,
      },
    });
    throw new ForbiddenError(
      `Role ${membership.roleKey} does not grant ${permission}`,
      'INSUFFICIENT_WORKSPACE_PERMISSION',
    );
  }

  return {
    workspaceId,
    memberId: membership.id,
    roleKey: membership.roleKey as WorkspaceRoleKey,
    permissions: getPermissionsForRole(membership.roleKey),
  };
}
