# CodePilot AI — Backend API & Asynchronous Worker

Standalone headless Node.js and Next.js App Router REST API backend plus independent SQS worker runtime for **CodePilot AI — Intelligent Code Review Platform**.

## Architecture (Phases 1–3 Complete)

- **Runtime:** Node.js 24 LTS, Next.js App Router Route Handlers (`output: 'standalone'`), independent Node.js worker (`src/worker/index.ts`), strict TypeScript
- **Database:** MySQL 8.4 LTS via Prisma ORM (`@prisma/adapter-mariadb`) with all 15 ordered version-controlled migration groups (`001_identity` through `015_performance_and_integrity`, 43 tables) and MySQL `FULLTEXT` indexing on `code_chunks`
- **Authentication, Multi-Tenancy & RBAC:** Argon2id password hashing, HttpOnly/SameSite session & refresh cookies with reuse detection, double-submit CSRF + Origin validation, strict CSP/HSTS headers, composite tenant foreign keys (`(workspace_id, id)`), and four-role RBAC where `PLATFORM_ADMIN` accesses anonymized platform telemetry (`GET /api/v1/admin/overview`) without automatic access to private tenant repository code.
- **GitHub Integration & Async Workers:** Least-privilege GitHub App installation flow, raw-body HMAC-SHA256 webhook verification with `timingSafeEqual` and delivery deduplication, transactional outbox + Amazon SQS/DLQ worker engine with heartbeats, retries, stale-lock recovery, and bounded concurrency.
- **Code Intelligence, AI Orchestration & Automated PR Reviews:** Safe `web-tree-sitter` WASM AST indexing (`@vscode/tree-sitter-wasm`), S3 artifact storage, MySQL full-text commit-scoped RAG, provider-agnostic AI orchestration (OpenAI, Anthropic, AWS Bedrock, deterministic Mock) with budgets/allowlists/circuit breakers/secret redaction/prompt-injection isolation, and a 12-state PR review engine with hallucination filtering, human approval gates, stale head-SHA checks, and duplicate comment reconciliation.
- **Security Intelligence, Architecture Analyzer, Advisory AI Assistant & AI Test Studio (Phase 3):**
  - Deterministic security scanning (Semgrep SAST rules, Gitleaks secret redaction, OSV dependency CVE auditing, ESLint security rules, Trivy container/IaC checks) strictly separated from advisory AI, with developer triage and owner-only expiring risk acceptances.
  - Deterministic module dependency graph analyzer with Tarjan's SCC circular dependency detection, configurable layer boundary rules, coupling/instability metrics, and orphan/hotspot detection.
  - Strictly advisory repository-aware AI coding assistant with Server-Sent Events (`text/event-stream`), verified file/line citations, code explanation, and refactoring suggestions.
  - Multi-language AI Test Studio (TypeScript/JavaScript primary + Python, Java, C#, Go adapters) with `web-tree-sitter` WASM syntax verification (`sandboxExecuted: false`) and human approval workflow.
  - Real database-backed Engineering Analytics (`/analytics/code-quality`, `/analytics/security`, `/analytics/review-performance`) and versioned AI evaluation harness (`evals/dataset-v1.json`, `npm run eval:ai`).
- **Contract:** OpenAPI 3.1.0 served at `GET /api/v1/openapi.json` (62 documented paths)

## Verification Commands

```bash
npm run format:check
npm run lint
npm run db:validate
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:authz
npm run test:phase2
npm run test:phase3
npm run eval:ai
npm audit --omit=dev --audit-level=high
npm run build
```

## Documentation

- [Authorization Matrix](docs/authorization-matrix.md)
- [GitHub App & Webhook Architecture](docs/github-integration.md)
- [AI Orchestration, Indexing & Review Pipeline](docs/ai-architecture.md)
- [Security & Scanning Architecture](docs/security-architecture.md)
- [STRIDE Threat Model](docs/threat-model.md)
- [AI Evaluation Framework](docs/ai-evaluations.md)
- [Blueprint Traceability Matrix](docs/blueprint-traceability.md)
- [Architecture Decision Records (ADR-001 – ADR-015)](docs/adr/)
