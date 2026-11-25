# ADR-006: Workspace RBAC and Platform Administrator Private-Code Boundary

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

CodePilot AI defines four roles: `PLATFORM_ADMIN`, `WORKSPACE_OWNER`, `DEVELOPER`, and `VIEWER`. Platform operators must not inadvertently gain unrestricted access to private tenant source repositories.

## Decision

Persist normalized `roles`, `permissions`, and `role_permissions` tables aligned with the domain RBAC matrix. Enforce workspace permissions exclusively through active `workspace_members` records. `PLATFORM_ADMIN` does not grant implicit workspace membership or repository read privileges.

## Consequences

- Clear least-privilege separation between platform operations and customer repository confidentiality.
- Verified automatically by `tests/authorization/rbac-and-tenant-isolation.test.ts`.
