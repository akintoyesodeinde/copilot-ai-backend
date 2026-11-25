# CodePilot AI — GitHub App Integration & Webhook Architecture

## 1. Least-Privilege GitHub App Permissions

CodePilot AI integrates via a GitHub App (never personal access tokens or user OAuth tokens with broad scopes):

- `contents: read` — read commit trees and file blobs for safe AST indexing (never writes code)
- `metadata: read` — read repository, branch, and commit metadata
- `pull_requests: write` — publish human-approved or policy-permitted PR review summaries and inline comments
- `checks: write` — report structured review status checks

Permissions **never requested**: organization admin, repository secrets, actions/workflow writes, deployments, or force-push access.

## 2. Installation Flow & Tenant Ownership Binding

1. An authenticated `WORKSPACE_OWNER` or `DEVELOPER` calls `GET /api/v1/github/install` (`X-Workspace-Id` scoped).
2. The backend generates an HMAC-SHA256 signed state token binding `{ workspaceId, userId, nonce, exp }` (15-minute TTL).
3. On callback (`GET /api/v1/github/callback`), the backend verifies the signed state, binds `github_installation_id` exclusively to that workspace (`UNIQUE(github_installation_id)`), and synchronizes repositories.
4. Attempting to re-bind an existing GitHub App installation to another workspace returns `409 Conflict`, preventing cross-tenant installation hijacking.
5. Revoking an installation (`DELETE /api/v1/github/installations/:id` or `installation.deleted` webhook) marks the installation `REVOKED`, stamps `access_revoked_at` on workspace repositories, and immediately blocks indexing and review publishing.

## 3. Raw-Body Webhook Security & Transactional Outbox

All webhooks arrive at `POST /api/v1/webhooks/github`:

1. Read exact raw request body (`request.text()`) before JSON parsing.
2. Validate `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET` using `crypto.timingSafeEqual`. Invalid/missing signatures return `401 Unauthorized`.
3. Deduplicate on `X-GitHub-Delivery` (`UNIQUE(github_delivery_id)` in `github_webhook_events`). Duplicate deliveries return `202 Accepted` with `deduplicated: true`.
4. Verify the payload's `installation.id` maps to a registered `ACTIVE` workspace installation (returning `403 Forbidden` for unauthorized installations).
5. Supported events: `installation`, `installation_repositories`, `push`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `repository`, `ping`.
6. State changes and asynchronous `AnalysisJob` + `OutboxEvent` records are persisted atomically in MySQL. HTTP handlers return `202 Accepted` immediately; the standalone Node.js worker (`src/worker/index.ts`) dispatches outbox events to Amazon SQS and executes jobs asynchronously.

## 4. Publishing Safety & Comment Reconciliation

- Publishing (`POST /api/v1/reviews/:id/publish`) requires an approved review when `workspace_settings.require_human_approval = true` (default).
- **Stale Head SHA Guard:** Before posting to GitHub, the backend fetches the live PR head SHA from GitHub. If commits were pushed since analysis ran, the review transitions to `STALE` and publishing is aborted with `409 Conflict`.
- **Duplicate Comment Prevention:** Findings are deduplicated by SHA-256 fingerprint (`workspaceId + pullRequestId + filePath + lineStart + ruleCode + category`), and published comments are tracked by `review_comments.fingerprint` + `github_comment_id` so re-publishing never duplicates existing inline comments.

## 5. Sandbox / Fixture Verification Mode vs Live Mode

- When `GITHUB_MODE=fixture` (used in CI and local development without external GitHub credentials), `FixtureGithubGateway` simulates GitHub App installation, repository synchronization, rate-limit backoff (HTTP 429), multi-page pagination, snapshot fetching, PR diffs, stale-SHA checks, and review publishing deterministically.
- When `GITHUB_MODE=live` with `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` configured, `OctokitGithubGateway` authenticates using `@octokit/auth-app` short-lived installation tokens and `@octokit/rest`.
