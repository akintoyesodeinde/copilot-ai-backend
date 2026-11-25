# ADR-002: Headless Next.js REST API and Modular Monolith Boundaries

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

The platform requires strict TypeScript REST API route handlers in Phase 1 while preparing cleanly for decoupled asynchronous Node.js background workers (SQS consumers, AST indexing, static analysis, and AI reviews) in Phases 2–3.

## Decision

Operate Next.js (`output: 'standalone'`) as a headless REST API structured as a modular monolith with explicit `domain/`, `application/`, and `infrastructure/` boundaries under `src/modules/*`. Long-running workloads will execute exclusively in independent Node.js worker entrypoints added in Phase 2, never inside HTTP route handlers.

## Consequences

- Predictable module ownership and testable domain logic independent of HTTP transport.
- Zero long-running compute inside request/response lifecycles.
