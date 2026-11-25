# ADR-004: Application-Layer Multi-Tenant Isolation with Composite MySQL Foreign Keys

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

MySQL 8.4 does not provide PostgreSQL-style native Row-Level Security (RLS), yet multi-tenant isolation is a strict security requirement.

## Decision

Enforce tenant isolation through:

1. Mandatory workspace resolution (`X-Workspace-Id` / `workspaceId`) and active membership verification in `requireWorkspacePermission`.
2. Tenant-scoped Prisma queries requiring `workspaceId` on every tenant resource lookup.
3. Composite unique indexes `(workspace_id, id)` and composite foreign keys on tenant-owned tables (`repositories`, `repository_branches`, `repository_commits`).

## Consequences

- Prevents cross-tenant foreign-key linkage at the database engine level and BOLA at the API layer.
- Dedicated cross-tenant negative tests run on every CI build.
