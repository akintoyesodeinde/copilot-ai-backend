# CodePilot AI — Performance, Reliability & Verification Report

## 1. Measured CI & Local Verification Metrics

All timings below reflect **actual measured runs** (never estimated or fabricated):

| Verification Stage                                                                                                            | Environment                                                    | Measured Result                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend CI Full Suite (Migrations 001–015, Drift, Double Seed, 25 Tests across 5 Suites, AI Evals, Audit, SBOM, `next build`) | GitHub Actions `ubuntu-latest` + MySQL 8.4 (Run `45663072414`) | **100% PASS** (`Lint, Typecheck, Migrations, Tests & Build` ~1m50s; Phase 2 suite 4s; Phase 3 suite 4s; AI Evals <1s)                                                                     |
| Backend + Worker Multi-Stage Docker Buildx                                                                                    | GitHub Actions `ubuntu-latest` (Run `45663072414`)             | **100% PASS** (`codepilot-ai-backend` ~2m57s, `codepilot-ai-worker` ~3m02s)                                                                                                               |
| Frontend CI Full Suite (Lint, Typecheck, 3 Unit + 5 Component Tests, Audit, `next build`, 2 Playwright Chromium Tests)        | GitHub Actions `ubuntu-latest` (Run `45663267738`)             | **100% PASS** (~1m20s) + Frontend Docker Buildx (~2m55s)                                                                                                                                  |
| Deterministic AI Evaluation Harness (`evals/dataset-v1.json` v1.0.0)                                                          | Local Windows + GitHub Actions CI                              | **11/11 PASS (100%)**, 0 false positives on clean code, 0 raw secret leaks, 100% hallucination rejection, 5/5 WASM test syntax valid                                                      |
| Live Local Full-Stack Proxy Smoke (`:3000` -> `:4000` -> MySQL 8.4)                                                           | Local Node.js 24 standalone builds                             | `200 OK` on `/health/live`, `/health/ready`, `/openapi.json` (62 documented paths), `/auth/login`, `/analytics/overview`, `/github/installations`, `/pull-requests`, `/ai/usage`, `/jobs` |

## 2. Reliability Controls Verified by Automated Tests

- **Database Connection & Transaction Resilience:** MariaDB pool configured with `connectionLimit: 10`, `connectTimeout: 30000ms`, `acquireTimeout: 30000ms`; interactive Prisma transactions configured with `maxWait: 15000ms`, `timeout: 25000–30000ms` to absorb bursty I/O on `db.t3.micro`.
- **Composite Index & Retention Hardening (Migration `015`):** Added composite query indexes on `vulnerabilities(workspace_id, status, severity, created_at DESC)`, `code_reviews(workspace_id, status, created_at DESC)`, `analysis_jobs(workspace_id, job_type, status)`, and `retention_expires_at` indexes on `audit_logs`, `ai_requests`, and `github_webhook_events`.
- **Async Worker Fault Tolerance:** Verified optimistic claim locking, heartbeat lock extensions, exponential backoff retries, stale-lock recovery (`recoverStaleJobs`), Dead-Letter Queue forwarding, and transactional outbox dispatching.
- **AI Provider Resilience:** Verified per-provider circuit breaker (`aiCircuitBreaker`), strict Zod schema rejection, and monthly USD/token quota circuit-breaking (`402 AI_BUDGET_EXCEEDED`).

## 3. Honest Verification Boundaries

- Live k6/load benchmarking against provisioned AWS EC2 `t3.small` + RDS `db.t3.micro` has **not** yet been executed because live AWS sandbox provisioning awaits explicit user approval (and AWS Organizations SCP `p-0nel9v63` currently blocks CloudFormation in the default CLI account).
- External GitHub App and paid LLM provider network latency were verified using deterministic fixture/mock gateways rather than live external API quotas.
