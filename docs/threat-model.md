# CodePilot AI — STRIDE Threat Model & OWASP Mitigations

## 1. System Trust Boundaries

1. **Public Internet -> Frontend Web App (Next.js `:3000`):** Untrusted browser traffic, mitigated by HTTPS/TLS, strict security headers (CSP, HSTS, `X-Frame-Options: DENY`), HttpOnly/SameSite session cookies, and double-submit CSRF tokens.
2. **Frontend Proxy -> Backend REST API (`:4000`):** Authenticated multi-tenant API boundary enforcing session validation, CSRF + Origin checks, sliding-window rate limits, Zod schema validation, and explicit RBAC permission checks per endpoint.
3. **GitHub Webhooks -> `POST /api/v1/webhooks/github`:** Untrusted internet ingress validated strictly by raw-body HMAC-SHA256 (`crypto.timingSafeEqual`), delivery-ID deduplication, and registered tenant installation lookup.
4. **API / Worker -> Untrusted Repository Source Code:** Treated strictly as hostile data. Never executed on the API or worker host; parsed only through `web-tree-sitter` WASM grammars with path traversal, symlink, binary, `.env`, and private-key exclusion guards.
5. **Backend / Worker -> External AI Providers (OpenAI, Anthropic, AWS Bedrock):** Prompt injection, secret exfiltration, and cost exhaustion boundary mitigated by pre-prompt secret redaction, `<UNTRUSTED_REPOSITORY_DATA>` delimiters, Zod structured output validation, finding path/line grounding, provider allowlists, circuit breakers, and hard monthly USD/token budgets.
6. **Backend / Worker -> Private MySQL 8.4 RDS & Private S3:** Zero public database access; composite tenant foreign keys (`(workspace_id, id)`) enforce multi-tenant referential isolation at the relational layer.

## 2. STRIDE Threat Matrix

| Category                   | Threat Scenario                                                                                               | Implemented Control                                                                                                                 | Verification                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Spoofing**               | Forged GitHub webhook or hijacked session                                                                     | Raw-body HMAC-SHA256 `timingSafeEqual`; Argon2id + rotated refresh tokens with family reuse revocation                              | `tests/integration`, `tests/phase2`                   |
| **Tampering**              | Cross-tenant IDOR, CSRF state change, stale PR publishing                                                     | Composite tenant FKs, `requireWorkspacePermission`, double-submit CSRF + Origin check, stale head-SHA guard                         | `tests/authorization`, `tests/phase2`, `tests/phase3` |
| **Repudiation**            | Unattributed security triage, risk acceptance, or approval                                                    | Immutable `audit_logs` capturing actor, tenant, action, resource, outcome, correlation ID                                           | `tests/integration`, `tests/phase3`                   |
| **Information Disclosure** | Secret leaks in Gitleaks/AI prompts/logs; `PLATFORM_ADMIN` reading tenant code                                | Pre-persistence secret redaction, Pino sensitive-field redaction, `PLATFORM_ADMIN` denied private tenant repository/security routes | `tests/authorization`, `tests/phase3`, `evals/`       |
| **Denial of Service**      | Brute-force login, AI spend spike, runaway worker retries                                                     | Auth rate limiting, monthly USD/token workspace budgets, circuit breaker, bounded worker concurrency & DLQ                          | `tests/unit`, `tests/phase2`                          |
| **Elevation of Privilege** | `DEVELOPER` accepting security risk or `VIEWER` triggering mutations; prompt injection triggering code writes | Role-scoped permissions (`WORKSPACE_UPDATE` for risk acceptance), strictly advisory AI assistant refusing mutation/shell commands   | `tests/authorization`, `tests/phase3`                 |

## 3. OWASP Coverage Mapping

- **OWASP ASVS v4:** Argon2id password storage, secure session cookies, strict input validation, security headers, audit logging, least privilege.
- **OWASP API Security Top 10:** Object-level & function-level authorization (`BOLA`/`BFLA`) enforced across every route handler, bounded cursor pagination, strict Zod payload parsing, no mass assignment.
- **OWASP Top 10 for LLM Applications:** Prompt injection isolation (`LLM01`), insecure output handling (`LLM02` via Zod & file/line verification), sensitive info disclosure (`LLM06` via secret redaction), excessive agency (`LLM08` via advisory-only assistant & human-approval publishing), overreliance (`LLM09` via deterministic vs AI separation & evaluations), unbounded consumption (`LLM10` via monthly budgets & token caps).
