import { getPrisma } from '@/shared/database/prisma';
import { ConflictError, NotFoundError, ValidationError } from '@/shared/http/problem-details';
import type { RequestContext } from '@/shared/http/route-handler';
import { generateOpaqueToken, sha256Hex } from '@/shared/security/tokens';
import { recordAuditEvent } from '@/modules/audit/application/audit.service';
import {
  PERMISSION_DEFINITIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  getPermissionsForRole,
} from '@/modules/authorization/domain/rbac';
import type {
  CreateInvitationInput,
  CreateWorkspaceInput,
  UpdateMemberInput,
  UpdateWorkspaceInput,
} from '@/modules/workspaces/domain/schemas';

function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base.length >= 2 ? base : `workspace-${generateOpaqueToken(4).toLowerCase()}`;
}

async function ensureSystemRolesExist(): Promise<void> {
  const prisma = getPrisma();
  const count = await prisma.role.count();
  if (count >= ROLE_DEFINITIONS.length) {
    return;
  }

  for (const perm of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: {
        key: perm.key,
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      },
    });
  }

  const allPermissions = await prisma.permission.findMany();
  const permByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  for (const roleDef of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: roleDef.key },
      update: { name: roleDef.name, description: roleDef.description },
      create: {
        key: roleDef.key,
        name: roleDef.name,
        scope: roleDef.scope,
        description: roleDef.description,
        isSystem: true,
      },
    });

    for (const permKey of roleDef.permissions) {
      const permissionId = permByKey.get(permKey);
      if (permissionId) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId: role.id, permissionId },
          },
          update: {},
          create: { roleId: role.id, permissionId },
        });
      }
    }
  }
}

export async function listUserWorkspaces(userId: string) {
  const prisma = getPrisma();
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      workspace: { archivedAt: null },
    },
    include: {
      workspace: {
        include: {
          _count: {
            select: {
              members: { where: { status: 'ACTIVE' } },
              repositories: { where: { isActive: true, accessRevokedAt: null } },
            },
          },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    description: m.workspace.description,
    planTier: m.workspace.planTier,
    roleKey: m.roleKey,
    permissions: getPermissionsForRole(m.roleKey),
    memberCount: m.workspace._count.members,
    repositoryCount: m.workspace._count.repositories,
    createdAt: m.workspace.createdAt.toISOString(),
    updatedAt: m.workspace.updatedAt.toISOString(),
  }));
}

export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
  ctx: RequestContext,
) {
  await ensureSystemRolesExist();
  const prisma = getPrisma();
  const slug = input.slug ? input.slug.toLowerCase() : slugifyName(input.name);

  const existing = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    throw new ConflictError(`Workspace slug '${slug}' is already taken`, 'WORKSPACE_SLUG_TAKEN');
  }

  const created = await prisma.$transaction(
    async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description?.trim() ?? null,
          createdByUserId: userId,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId,
          roleKey: ROLE_KEYS.WORKSPACE_OWNER,
          status: 'ACTIVE',
        },
      });

      const settings = await tx.workspaceSetting.create({
        data: {
          workspaceId: workspace.id,
          defaultAiProvider: 'mock',
          allowedAiProvidersJson: ['mock'],
          requireHumanApproval: true,
          autoReviewEnabled: false,
          dataRetentionDays: 90,
        },
      });

      const usageLimit = await tx.usageLimit.create({
        data: {
          workspaceId: workspace.id,
        },
      });

      await tx.notification.create({
        data: {
          workspaceId: workspace.id,
          userId,
          type: 'workspace.welcome',
          severity: 'INFO',
          title: `Workspace "${workspace.name}" is ready`,
          body: 'Configure workspace settings, invite engineering team members, and prepare GitHub integration.',
          linkPath: '/settings',
        },
      });

      return { workspace, settings, usageLimit };
    },
    { maxWait: 15_000, timeout: 25_000 },
  );

  await recordAuditEvent({
    workspaceId: created.workspace.id,
    actorUserId: userId,
    action: 'workspace.created',
    resourceType: 'workspace',
    resourceId: created.workspace.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { slug: created.workspace.slug },
  });

  return {
    id: created.workspace.id,
    name: created.workspace.name,
    slug: created.workspace.slug,
    description: created.workspace.description,
    planTier: created.workspace.planTier,
    roleKey: ROLE_KEYS.WORKSPACE_OWNER,
    permissions: getPermissionsForRole(ROLE_KEYS.WORKSPACE_OWNER),
    settings: {
      defaultAiProvider: created.settings.defaultAiProvider,
      allowedAiProviders: created.settings.allowedAiProvidersJson as string[],
      requireHumanApproval: created.settings.requireHumanApproval,
      autoReviewEnabled: created.settings.autoReviewEnabled,
      dataRetentionDays: created.settings.dataRetentionDays,
    },
    usageLimits: {
      monthlyAiBudgetUsd: Number(created.usageLimit.monthlyAiBudgetUsd),
      maxMonthlyTokens: created.usageLimit.maxMonthlyTokens,
      maxRepositories: created.usageLimit.maxRepositories,
      maxMembers: created.usageLimit.maxMembers,
      currentMonthTokens: created.usageLimit.currentMonthTokens,
      currentMonthSpendUsd: Number(created.usageLimit.currentMonthSpendUsd),
    },
    createdAt: created.workspace.createdAt.toISOString(),
    updatedAt: created.workspace.updatedAt.toISOString(),
  };
}

export async function getWorkspaceDetail(workspaceId: string, roleKey: string) {
  const prisma = getPrisma();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      settings: true,
      usageLimit: true,
      _count: {
        select: {
          members: { where: { status: 'ACTIVE' } },
          invitations: { where: { status: 'PENDING' } },
          repositories: { where: { isActive: true, accessRevokedAt: null } },
        },
      },
    },
  });

  if (!workspace || workspace.archivedAt !== null) {
    throw new NotFoundError('Workspace not found', 'WORKSPACE_NOT_FOUND');
  }

  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    planTier: workspace.planTier,
    roleKey,
    permissions: getPermissionsForRole(roleKey),
    counts: {
      activeMembers: workspace._count.members,
      pendingInvitations: workspace._count.invitations,
      activeRepositories: workspace._count.repositories,
    },
    settings: workspace.settings
      ? {
          defaultAiProvider: workspace.settings.defaultAiProvider,
          allowedAiProviders: workspace.settings.allowedAiProvidersJson as string[],
          requireHumanApproval: workspace.settings.requireHumanApproval,
          autoReviewEnabled: workspace.settings.autoReviewEnabled,
          dataRetentionDays: workspace.settings.dataRetentionDays,
        }
      : null,
    usageLimits: workspace.usageLimit
      ? {
          monthlyAiBudgetUsd: Number(workspace.usageLimit.monthlyAiBudgetUsd),
          maxMonthlyTokens: workspace.usageLimit.maxMonthlyTokens,
          maxRepositories: workspace.usageLimit.maxRepositories,
          maxMembers: workspace.usageLimit.maxMembers,
          currentMonthTokens: workspace.usageLimit.currentMonthTokens,
          currentMonthSpendUsd: Number(workspace.usageLimit.currentMonthSpendUsd),
        }
      : null,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export async function updateWorkspace(
  workspaceId: string,
  actorUserId: string,
  roleKey: string,
  input: UpdateWorkspaceInput,
  ctx: RequestContext,
) {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    if (input.name !== undefined || input.description !== undefined) {
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description === null ? null : input.description.trim() }
            : {}),
        },
      });
    }

    if (input.settings) {
      await tx.workspaceSetting.upsert({
        where: { workspaceId },
        update: {
          ...(input.settings.defaultAiProvider !== undefined
            ? { defaultAiProvider: input.settings.defaultAiProvider }
            : {}),
          ...(input.settings.allowedAiProviders !== undefined
            ? { allowedAiProvidersJson: input.settings.allowedAiProviders }
            : {}),
          ...(input.settings.requireHumanApproval !== undefined
            ? { requireHumanApproval: input.settings.requireHumanApproval }
            : {}),
          ...(input.settings.autoReviewEnabled !== undefined
            ? { autoReviewEnabled: input.settings.autoReviewEnabled }
            : {}),
          ...(input.settings.dataRetentionDays !== undefined
            ? { dataRetentionDays: input.settings.dataRetentionDays }
            : {}),
        },
        create: {
          workspaceId,
          defaultAiProvider: input.settings.defaultAiProvider ?? 'mock',
          allowedAiProvidersJson: input.settings.allowedAiProviders ?? ['mock'],
          requireHumanApproval: input.settings.requireHumanApproval ?? true,
          autoReviewEnabled: input.settings.autoReviewEnabled ?? false,
          dataRetentionDays: input.settings.dataRetentionDays ?? 90,
        },
      });
    }

    if (input.usageLimits) {
      await tx.usageLimit.upsert({
        where: { workspaceId },
        update: {
          ...(input.usageLimits.monthlyAiBudgetUsd !== undefined
            ? { monthlyAiBudgetUsd: input.usageLimits.monthlyAiBudgetUsd }
            : {}),
          ...(input.usageLimits.maxMonthlyTokens !== undefined
            ? { maxMonthlyTokens: input.usageLimits.maxMonthlyTokens }
            : {}),
        },
        create: {
          workspaceId,
          monthlyAiBudgetUsd: input.usageLimits.monthlyAiBudgetUsd ?? 25,
          maxMonthlyTokens: input.usageLimits.maxMonthlyTokens ?? 2_000_000,
        },
      });
    }
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'workspace.updated',
    resourceType: 'workspace',
    resourceId: workspaceId,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { updatedFields: Object.keys(input) },
  });

  return getWorkspaceDetail(workspaceId, roleKey);
}

export async function listWorkspaceMembers(workspaceId: string) {
  const prisma = getPrisma();
  const [members, invitations] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId, status: { not: 'REMOVED' } },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        invitedBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    members: members.map((m) => ({
      id: m.id,
      workspaceId: m.workspaceId,
      userId: m.userId,
      roleKey: m.roleKey,
      status: m.status,
      joinedAt: m.joinedAt.toISOString(),
      user: {
        id: m.user.id,
        email: m.user.email,
        fullName: m.user.fullName,
        avatarUrl: m.user.avatarUrl,
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
      },
    })),
    pendingInvitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      roleKey: inv.roleKey,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      invitedBy: inv.invitedBy,
    })),
  };
}

export async function createWorkspaceInvitation(
  workspaceId: string,
  actorUserId: string,
  input: CreateInvitationInput,
  ctx: RequestContext,
) {
  await ensureSystemRolesExist();
  const prisma = getPrisma();
  const email = input.email.trim().toLowerCase();

  const [usageLimit, activeMemberCount, existingUser] = await Promise.all([
    prisma.usageLimit.findUnique({ where: { workspaceId } }),
    prisma.workspaceMember.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);

  if (usageLimit && activeMemberCount >= usageLimit.maxMembers) {
    throw new ConflictError(
      `Workspace member limit (${usageLimit.maxMembers}) has been reached`,
      'MEMBER_LIMIT_EXCEEDED',
    );
  }

  if (existingUser) {
    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: existingUser.id },
      },
    });
    if (existingMember && existingMember.status === 'ACTIVE') {
      throw new ConflictError(
        'User is already an active member of this workspace',
        'ALREADY_MEMBER',
      );
    }
  }

  const existingInvite = await prisma.workspaceInvitation.findFirst({
    where: {
      workspaceId,
      email,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
  });

  if (existingInvite) {
    throw new ConflictError(
      'An active invitation already exists for this email address',
      'INVITATION_ALREADY_EXISTS',
    );
  }

  const rawToken = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email,
      roleKey: input.roleKey,
      tokenHash: sha256Hex(rawToken),
      invitedByUserId: actorUserId,
      status: 'PENDING',
      expiresAt,
    },
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'workspace.member_invited',
    resourceType: 'workspace_invitation',
    resourceId: invitation.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { email, roleKey: input.roleKey },
  });

  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    roleKey: invitation.roleKey,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

export async function updateWorkspaceMember(
  workspaceId: string,
  memberId: string,
  actorUserId: string,
  input: UpdateMemberInput,
  ctx: RequestContext,
) {
  const prisma = getPrisma();

  const target = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_id: {
        workspaceId,
        id: memberId,
      },
    },
    include: {
      user: {
        select: { id: true, email: true, fullName: true, avatarUrl: true },
      },
    },
  });

  if (!target) {
    throw new NotFoundError('Workspace member not found', 'MEMBER_NOT_FOUND');
  }

  const demotingOwner =
    target.roleKey === ROLE_KEYS.WORKSPACE_OWNER &&
    target.status === 'ACTIVE' &&
    ((input.roleKey && input.roleKey !== ROLE_KEYS.WORKSPACE_OWNER) ||
      (input.status && input.status !== 'ACTIVE'));

  if (demotingOwner) {
    const activeOwnerCount = await prisma.workspaceMember.count({
      where: {
        workspaceId,
        roleKey: ROLE_KEYS.WORKSPACE_OWNER,
        status: 'ACTIVE',
      },
    });
    if (activeOwnerCount <= 1) {
      throw new ValidationError('Cannot remove or demote the last active Workspace Owner', [
        { field: 'roleKey', message: 'Workspace must have at least one active owner' },
      ]);
    }
  }

  const updated = await prisma.workspaceMember.update({
    where: {
      workspaceId_id: {
        workspaceId,
        id: memberId,
      },
    },
    data: {
      ...(input.roleKey !== undefined ? { roleKey: input.roleKey } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    include: {
      user: {
        select: { id: true, email: true, fullName: true, avatarUrl: true },
      },
    },
  });

  await recordAuditEvent({
    workspaceId,
    actorUserId,
    action: 'workspace.member_updated',
    resourceType: 'workspace_member',
    resourceId: updated.id,
    outcome: 'SUCCESS',
    correlationId: ctx.correlationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      targetUserId: updated.userId,
      previousRole: target.roleKey,
      newRole: updated.roleKey,
      previousStatus: target.status,
      newStatus: updated.status,
    },
  });

  return {
    id: updated.id,
    workspaceId: updated.workspaceId,
    userId: updated.userId,
    roleKey: updated.roleKey,
    status: updated.status,
    joinedAt: updated.joinedAt.toISOString(),
    user: updated.user,
  };
}
