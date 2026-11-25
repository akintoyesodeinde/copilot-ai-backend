# ADR-005: Session Authentication, Argon2id, Refresh Rotation, and CSRF Protection

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

Browser sessions for the standalone frontend and backend must mitigate credential stuffing, XSS token theft, CSRF, and stolen refresh token replay.

## Decision

- Hash passwords with Argon2id (64 MiB memory cost, time cost 3).
- Store only SHA-256 hashes of opaque session tokens, refresh tokens, and CSRF tokens in MySQL (`sessions`, `refresh_tokens`).
- Issue `HttpOnly`, `SameSite=Lax` (`Secure` in production) cookies for `cp_session` and `cp_refresh`, plus a double-submit `cp_csrf` token validated via `X-CSRF-Token` alongside strict `Origin`/`Referer` allowlisting on state-changing requests.
- Rotate refresh tokens on every refresh and revoke the entire token family and session if reuse of a rotated/revoked token is detected.

## Consequences

- Plaintext session credentials are never persisted in MySQL or exposed to browser JavaScript.
- Stolen refresh token replay is detected and neutralized with an audit event.
