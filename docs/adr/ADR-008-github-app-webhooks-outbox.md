# ADR-008: Least-Privilege GitHub App, Raw-Body HMAC Webhooks, and Transactional Outbox

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 2

## Decision

Authenticate to GitHub using short-lived GitHub App installation tokens (`@octokit/auth-app` + `@octokit/rest`) scoped only to `contents: read`, `metadata: read`, `pull_requests: write`, and `checks: write`. Verify webhook signatures against the untouched raw request body using HMAC-SHA256 and `crypto.timingSafeEqual`, deduplicate deliveries by unique `github_delivery_id`, validate active installation-to-workspace ownership, and persist `github_webhook_events`, `analysis_jobs`, and `outbox_events` atomically before returning HTTP `202 Accepted`.
