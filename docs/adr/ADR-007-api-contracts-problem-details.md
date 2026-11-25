# ADR-007: RFC 9457 Problem Details, Cursor Pagination, and OpenAPI 3.1 Contracts

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

The standalone frontend and future API consumers require predictable response envelopes, stable pagination under concurrent writes, machine-readable errors, and end-to-end request traceability.

## Decision

- Wrap successful responses in `{ data, meta: { requestId, timestamp, pagination? } }`.
- Return all errors as RFC 9457 `application/problem+json` including `type`, `title`, `status`, `detail`, `instance`, `code`, `correlationId`, and optional field `errors`.
- Use opaque base64url `(createdAt, id)` cursor pagination for collection endpoints (`repositories`, `notifications`, `audit-logs`).
- Serve a live OpenAPI 3.1.0 specification at `GET /api/v1/openapi.json`.

## Consequences

- Consistent error handling in frontend clients and clean correlation across Pino logs and audit records.
