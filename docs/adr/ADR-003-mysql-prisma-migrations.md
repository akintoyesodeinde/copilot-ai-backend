# ADR-003: MySQL 8.4 LTS with Prisma ORM and Versioned SQL Migrations

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

CodePilot AI targets Amazon RDS MySQL 8.4 LTS (`db.t3.micro`) in deployment and requires auditable, reproducible schema evolution without destructive schema pushes.

## Decision

Use MySQL 8.4 LTS with Prisma 7 (`@prisma/adapter-mariadb`) and reviewed, ordered SQL migrations in `prisma/migrations/` organized by dependency groups (`001`–`005` in Phase 1). Deployment and CI environments apply migrations exclusively via `prisma migrate deploy` (never `prisma db push`).

## Consequences

- Deterministic schema history validated against live MySQL 8.4 in every CI run.
- UTC `DATETIME(3)` timestamps and InnoDB referential integrity across all tables.
