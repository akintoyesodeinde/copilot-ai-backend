# CodePilot AI — Backend API, Asynchronous Worker & AWS Infrastructure

Standalone headless Node.js and Next.js App Router REST API backend, independent SQS worker runtime, and AWS CloudFormation Sandbox Infrastructure-as-Code for **CodePilot AI — Intelligent Code Review Platform**.

## Complete Architecture (All 4 Phases Implemented)

- **Runtime:** Node.js 24 LTS, Next.js App Router Route Handlers (`output: 'standalone'`), standalone Node.js SQS worker (`src/worker/index.ts`), strict TypeScript
- **Database:** MySQL 8.4 LTS via Prisma ORM (`@prisma/adapter-mariadb`) with all **15 ordered migration groups** (`001_identity` through `015_performance_and_integrity`, 43 tables) and MySQL `FULLTEXT` indexing on `code_chunks`
- **Multi-Tenancy, Auth & RBAC:** Argon2id password hashing, HttpOnly/SameSite session & refresh cookies with reuse detection, double-submit CSRF + Origin checks, strict CSP/HSTS headers, composite tenant foreign keys (`(workspace_id, id)`), and four-role RBAC where `PLATFORM_ADMIN` accesses anonymized platform telemetry (`GET /api/v1/admin/overview`) without automatic access to private tenant repository code.
- **GitHub Integration & Async Workers:** Least-privilege GitHub App installation flow, raw-body HMAC-SHA256 webhook verification (`timingSafeEqual`) with delivery deduplication, transactional outbox + Amazon SQS/DLQ worker with heartbeats, retries, stale-lock recovery, and bounded concurrency.
- **Code Intelligence, AI Orchestration & Automated PR Reviews:** Safe `web-tree-sitter` WASM AST indexing (`@vscode/tree-sitter-wasm`), encrypted private S3 artifacts, commit-scoped MySQL `FULLTEXT` RAG, provider-agnostic AI adapters (OpenAI, Anthropic, AWS Bedrock, deterministic Mock) with budgets/allowlists/circuit breakers/secret redaction/prompt-injection isolation, and a 12-state PR review engine with hallucination filtering, human approval gates, stale head-SHA checks, and duplicate comment reconciliation.
- **Security Intelligence, Architecture Explorer, Advisory AI Assistant & AI Test Studio:**
  - Deterministic security scanners (Semgrep SAST rules, Gitleaks secret redaction, OSV dependency CVE auditing, ESLint security rules, Trivy container/IaC checks) strictly separated from advisory AI, with developer triage and Workspace Owner time-bound risk acceptances.
  - Deterministic module dependency graph analyzer with Tarjan SCC circular dependency detection, layer boundary rules, and Martin instability metrics.
  - Strictly advisory repository-aware AI assistant with SSE streaming (`text/event-stream`), verified file/line citations, code explanation, and refactoring recommendations.
  - Multi-language AI Test Studio (TypeScript/JavaScript primary + Python, Java, C#, Go adapters) with `web-tree-sitter` WASM syntax verification (`sandboxExecuted: false`) and engineer approval.
  - Versioned AI evaluation dataset (`evals/dataset-v1.json`) and CI runner (`npm run eval:ai` — 11/11 benchmarks verified).
- **AWS Sandbox Infrastructure & Release Automation (Phase 4):**
  - 4 CloudFormation stacks (`infra/cloudformation/01..04*.yaml`): VPC + public/2 private DB subnets, zero public SSH (SSM only), private Single-AZ encrypted RDS MySQL 8.4 `db.t3.micro`, private AES-256 S3, SQS + DLQ, EC2 Launch Template (`t3.small`, IMDSv2, encrypted gp3), GitHub Actions IAM OIDC role (zero static AWS keys), CloudWatch alarms, and `$40/month` AWS Budgets (50%/80%/100%).
  - Idempotent EC2 bootstrap (`infra/ec2/user-data.sh`), production Docker Compose (`infra/ec2/docker-compose.prod.yml`), hardened Nginx TLS reverse proxy (`infra/ec2/nginx.conf`), Windows PowerShell provisioning/smoke/teardown scripts (`infra/scripts/*.ps1`), and serialized Docker Hub + OIDC/SSM release workflow (`.github/workflows/release-and-deploy.yml`).
- **Contract:** OpenAPI 3.1.0 served at `GET /api/v1/openapi.json` (62 documented endpoints)

## Documentation Suite

- [System Architecture & Sequence Diagrams](docs/architecture.md)
- [Database ERD & 15 Migration Groups](docs/database-erd.md)
- [Authorization Matrix](docs/authorization-matrix.md)
- [GitHub App & Webhook Architecture](docs/github-integration.md)
- [AI Orchestration, Indexing & Review Pipeline](docs/ai-architecture.md)
- [Security & Scanning Architecture](docs/security-architecture.md)
- [STRIDE Threat Model](docs/threat-model.md)
- [AI Evaluation Framework](docs/ai-evaluations.md)
- [AWS Sandbox Deployment Guide](docs/aws-deployment.md)
- [CI/CD & Container Release Pipeline](docs/ci-cd-release.md)
- [AWS Cost Estimation & Budget Controls](docs/cost-management.md)
- [Operations & Incident Response Runbook](docs/operations-runbook.md)
- [Performance & Reliability Verification](docs/performance-verification.md)
- [20-Step Sandbox Demonstration Walkthrough](docs/demo-walkthrough.md)
- [Production-Readiness Checklist (DoD)](docs/production-readiness-checklist.md)
- [33-Deliverable Blueprint Traceability Matrix](docs/blueprint-traceability.md)
- [Architecture Decision Records (ADR-001 – ADR-015)](docs/adr/)
