export const ROLE_KEYS = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  WORKSPACE_OWNER: 'WORKSPACE_OWNER',
  DEVELOPER: 'DEVELOPER',
  VIEWER: 'VIEWER',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

export const WORKSPACE_ROLE_KEYS = [
  ROLE_KEYS.WORKSPACE_OWNER,
  ROLE_KEYS.DEVELOPER,
  ROLE_KEYS.VIEWER,
] as const;

export type WorkspaceRoleKey = (typeof WORKSPACE_ROLE_KEYS)[number];

export const PERMISSIONS = {
  WORKSPACE_READ: 'workspace:read',
  WORKSPACE_UPDATE: 'workspace:update',
  MEMBER_READ: 'member:read',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE: 'member:update',
  REPOSITORY_READ: 'repository:read',
  REPOSITORY_WRITE: 'repository:write',
  ANALYTICS_READ: 'analytics:read',
  NOTIFICATION_READ: 'notification:read',
  AUDIT_READ: 'audit:read',
  PLATFORM_ADMIN: 'platform:admin',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  scope: 'PLATFORM' | 'WORKSPACE';
  description: string;
  permissions: readonly PermissionKey[];
}

/**
 * Canonical RBAC matrix.
 * Security invariant: PLATFORM_ADMIN does NOT receive automatic access
 * to private workspace repositories or tenant source data.
 */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: ROLE_KEYS.PLATFORM_ADMIN,
    name: 'Platform Administrator',
    scope: 'PLATFORM',
    description:
      'Platform operations and system governance without automatic access to private tenant repository code.',
    permissions: [PERMISSIONS.PLATFORM_ADMIN],
  },
  {
    key: ROLE_KEYS.WORKSPACE_OWNER,
    name: 'Workspace Owner',
    scope: 'WORKSPACE',
    description:
      'Full administrative control over workspace settings, members, invitations, repositories, and audit logs.',
    permissions: [
      PERMISSIONS.WORKSPACE_READ,
      PERMISSIONS.WORKSPACE_UPDATE,
      PERMISSIONS.MEMBER_READ,
      PERMISSIONS.MEMBER_INVITE,
      PERMISSIONS.MEMBER_UPDATE,
      PERMISSIONS.REPOSITORY_READ,
      PERMISSIONS.REPOSITORY_WRITE,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.NOTIFICATION_READ,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  {
    key: ROLE_KEYS.DEVELOPER,
    name: 'Developer',
    scope: 'WORKSPACE',
    description:
      'Engineering access to workspace repositories, analytics, and operational code intelligence workflows.',
    permissions: [
      PERMISSIONS.WORKSPACE_READ,
      PERMISSIONS.MEMBER_READ,
      PERMISSIONS.REPOSITORY_READ,
      PERMISSIONS.REPOSITORY_WRITE,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.NOTIFICATION_READ,
    ],
  },
  {
    key: ROLE_KEYS.VIEWER,
    name: 'Viewer',
    scope: 'WORKSPACE',
    description:
      'Read-only access to workspace repositories, dashboard analytics, and own notifications.',
    permissions: [
      PERMISSIONS.WORKSPACE_READ,
      PERMISSIONS.MEMBER_READ,
      PERMISSIONS.REPOSITORY_READ,
      PERMISSIONS.ANALYTICS_READ,
      PERMISSIONS.NOTIFICATION_READ,
    ],
  },
] as const;

export const PERMISSION_DEFINITIONS: ReadonlyArray<{
  key: PermissionKey;
  resource: string;
  action: string;
  description: string;
}> = [
  {
    key: PERMISSIONS.WORKSPACE_READ,
    resource: 'workspace',
    action: 'read',
    description: 'View workspace overview, settings, and limits',
  },
  {
    key: PERMISSIONS.WORKSPACE_UPDATE,
    resource: 'workspace',
    action: 'update',
    description: 'Modify workspace settings, policies, and budgets',
  },
  {
    key: PERMISSIONS.MEMBER_READ,
    resource: 'member',
    action: 'read',
    description: 'List workspace members and pending invitations',
  },
  {
    key: PERMISSIONS.MEMBER_INVITE,
    resource: 'member',
    action: 'invite',
    description: 'Invite new users into a workspace',
  },
  {
    key: PERMISSIONS.MEMBER_UPDATE,
    resource: 'member',
    action: 'update',
    description: 'Update workspace member roles or status',
  },
  {
    key: PERMISSIONS.REPOSITORY_READ,
    resource: 'repository',
    action: 'read',
    description: 'View connected repositories, branches, and commits',
  },
  {
    key: PERMISSIONS.REPOSITORY_WRITE,
    resource: 'repository',
    action: 'write',
    description: 'Trigger repository synchronization, indexing, and reviews',
  },
  {
    key: PERMISSIONS.ANALYTICS_READ,
    resource: 'analytics',
    action: 'read',
    description: 'View workspace engineering intelligence analytics',
  },
  {
    key: PERMISSIONS.NOTIFICATION_READ,
    resource: 'notification',
    action: 'read',
    description: 'Read and acknowledge workspace notifications',
  },
  {
    key: PERMISSIONS.AUDIT_READ,
    resource: 'audit',
    action: 'read',
    description: 'Inspect workspace security and operational audit logs',
  },
  {
    key: PERMISSIONS.PLATFORM_ADMIN,
    resource: 'platform',
    action: 'admin',
    description: 'Manage platform-level operations without implicit tenant source code access',
  },
];

const rolePermissionsMap = new Map<string, ReadonlySet<PermissionKey>>(
  ROLE_DEFINITIONS.map((role) => [role.key, new Set(role.permissions)]),
);

export function getPermissionsForRole(roleKey: string): PermissionKey[] {
  return Array.from(rolePermissionsMap.get(roleKey) ?? []);
}

export function hasWorkspacePermission(roleKey: string, permission: PermissionKey): boolean {
  if (roleKey === ROLE_KEYS.PLATFORM_ADMIN) {
    return false;
  }
  const perms = rolePermissionsMap.get(roleKey);
  return perms ? perms.has(permission) : false;
}

export function isAssignableWorkspaceRole(roleKey: string): roleKey is WorkspaceRoleKey {
  return (WORKSPACE_ROLE_KEYS as readonly string[]).includes(roleKey);
}
