# Authorization Matrix & Multi-Tenant Isolation

CodePilot AI enforces tenant isolation at two layers:

1. **Application authorization (`src/modules/authorization/application/authz.service.ts`)**: Every workspace-scoped request validates an active `workspace_members` row for `(workspaceId, userId)` and checks the role's granted permissions. Denied requests record an `authorization.*_denied` audit event.
2. **Relational integrity (`prisma/migrations/*`)**: Tenant-owned child tables (`repositories`, `repository_branches`, `repository_commits`) enforce composite foreign keys including `workspace_id`, preventing cross-tenant references at the MySQL InnoDB layer.

## Role Matrix (Phase 1)

| Capability / Permission                                          | Platform Administrator              | Workspace Owner | Developer | Viewer  |
| ---------------------------------------------------------------- | ----------------------------------- | --------------- | --------- | ------- |
| `platform:admin` (platform health/governance)                    | Allowed                             | Denied          | Denied    | Denied  |
| `workspace:read` (view workspace metadata/settings)              | Denied unless explicit member       | Allowed         | Allowed   | Allowed |
| `workspace:update` (update workspace, settings, AI budgets)      | Denied unless explicit member       | Allowed         | Denied    | Denied  |
| `member:read` (list members & pending invitations)               | Denied unless explicit member       | Allowed         | Allowed   | Allowed |
| `member:invite` (create workspace invitations)                   | Denied unless explicit member       | Allowed         | Denied    | Denied  |
| `member:update` (change member roles/status)                     | Denied unless explicit member       | Allowed         | Denied    | Denied  |
| `repository:read` (list/inspect repositories, branches, commits) | **Explicitly Denied** unless member | Allowed         | Allowed   | Allowed |
| `repository:write` (sync, index, trigger reviews — Phase 2+)     | **Explicitly Denied** unless member | Allowed         | Allowed   | Denied  |
| `analytics:read` (workspace engineering metrics)                 | Denied unless explicit member       | Allowed         | Allowed   | Allowed |
| `notification:read` (own workspace notifications)                | Denied unless explicit member       | Allowed         | Allowed   | Allowed |
| `audit:read` (workspace security & operational audit logs)       | Denied unless explicit member       | Allowed         | Denied    | Denied  |

## Security Invariants

- **Platform Admin Private-Code Boundary:** `PLATFORM_ADMIN` never bypasses `workspace_members` verification.
- **Last Owner Protection:** The last active `WORKSPACE_OWNER` in a workspace cannot be demoted or removed.
- **Broken Object-Level Authorization (BOLA) Defense:** Repository detail lookups query by composite `(workspace_id, id)`, returning `404` when an object belongs to another tenant.
