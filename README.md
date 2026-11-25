# CodePilot AI — Backend API & Asynchronous Worker

Standalone headless Node.js and Next.js App Router REST API backend plus independent SQS worker runtime for **CodePilot AI — Intelligent Code Review Platform**.

## Architecture (Phases 1 & 2)

- **Runtime:** Node.js 24 LTS, Next.js App Router Route Handlers (`output: 'standalone'`), independent Node.js worker (`src/worker/index.ts`), strict TypeScript
- **Database:** MySQL 8.4 LTS via Prisma ORM (`@prisma/adapter-mariadb`) with 10 ordered version-controlled migration groups (`001_identity` through `010_automated_reviews`) and MySQL `FULLTEXT` indexing on `code_chunks`
- **Authentication & Security:** Argon2id password hashing, HttpOnly/SameSite session & refresh cookies, refresh token rotation with family reuse detection, double-submit CSRF + Origin validation, sliding-window auth rate limiting, RFC 9457 Problem Details error responses, Pino structured JSON logging with redaction, and OpenTelemetry instrumentation
- **Multi-Tenancy & RBAC:** Strict application-layer tenant scoping reinforced by MySQL composite tenant foreign keys (`(workspace_id, id)`). Four system roles (`PLATFORM_ADMIN`, `WORKSPACE_OWNER`, `DEVELOPER`, `VIEWER`) where `PLATFORM_ADMIN` does **not** inherit automatic access to private tenant repository code.
- **GitHub Integration & Async Workers (Phase 2):** Least-privilege GitHub App installation flow, raw-body HMAC-SHA256 webhook verification with `timingSafeEqual` and delivery deduplication, transactional outbox + Amazon SQS/DLQ worker engine with heartbeats, retries, stale-lock recovery, and bounded concurrency.
- **Code Intelligence, AI Orchestration & PR Reviews (Phase 2):** Safe `web-tree-sitter` WASM AST indexing (`@vscode/tree-sitter-wasm`) with path/secret exclusion guards, S3 artifact storage, MySQL full-text commit-scoped RAG, provider-agnostic AI adapters (OpenAI, Anthropic, AWS Bedrock, deterministic Mock) with workspace budgets/allowlists/circuit breakers/secret redaction/prompt-injection isolation, and a 12-state automated PR review engine with hallucination filtering, human approval gates, stale head-SHA checks, and duplicate comment reconciliation.
- **Contract:** OpenAPI 3.1.0 served at `GET /api/v1/openapi.json`

## Local Development Startup

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start MySQL 8.4 and ElasticMQ (local SQS) via Docker Compose
docker compose up -d mysql elasticmq

# 3. Install dependencies, generate Prisma client, run migrations, and seed synthetic dev data
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed

# 4. Run REST API server on http://localhost:4000
npm run dev

# 5. In a second terminal, run the independent background worker
npm run worker
```

### Synthetic Development Seed Credentials

Running `npm run db:seed` creates synthetic local development accounts (password: `CodePilot!Dev2026`):

- Workspace Owner: `owner@acme-synthetic.dev`
- Developer: `dev@acme-synthetic.dev`
- Viewer: `viewer@acme-synthetic.dev`
- Platform Administrator: `admin@codepilot-platform.dev`

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
npm run build
```

## Documentation

- [Authorization Matrix](docs/authorization-matrix.md)
- [GitHub App & Webhook Architecture](docs/github-integration.md)
- [AI Orchestration, Indexing & Review Pipeline](docs/ai-architecture.md)
- [Blueprint Traceability Matrix](docs/blueprint-traceability.md)
- [Architecture Decision Records (ADR-001 – ADR-012)](docs/adr/)
