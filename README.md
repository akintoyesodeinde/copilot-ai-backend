# CodePilot AI — Backend API

Standalone headless Node.js and Next.js App Router REST API backend for **CodePilot AI — Intelligent Code Review Platform**.

## Architecture (Phase 1 Foundation)

- **Runtime:** Node.js 24 LTS, Next.js App Router Route Handlers (`output: 'standalone'`), strict TypeScript
- **Database:** MySQL 8.4 LTS via Prisma ORM (`@prisma/adapter-mariadb`) with 5 ordered version-controlled migration groups (`001_identity` through `005_repository_foundation`)
- **Authentication & Security:** Argon2id password hashing, HttpOnly/SameSite session & refresh cookies, refresh token rotation with family reuse detection, double-submit CSRF + Origin validation, sliding-window auth rate limiting, RFC 9457 Problem Details error responses, Pino structured JSON logging with automatic redaction, and OpenTelemetry instrumentation
- **Multi-Tenancy & RBAC:** Strict application-layer tenant scoping reinforced by MySQL composite tenant foreign keys (`(workspace_id, id)`). Four system roles (`PLATFORM_ADMIN`, `WORKSPACE_OWNER`, `DEVELOPER`, `VIEWER`) where `PLATFORM_ADMIN` does **not** inherit automatic access to private tenant repository code.
- **Contract:** OpenAPI 3.1.0 served at `GET /api/v1/openapi.json`

## Local Development Startup

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Start MySQL 8.4 via Docker Compose
docker compose up -d mysql

# 3. Install dependencies, generate Prisma client, run migrations, and seed synthetic dev data
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed

# 4. Run development server on http://localhost:4000
npm run dev
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
npm run build
```

## Documentation

- [Authorization Matrix](docs/authorization-matrix.md)
- [Blueprint Traceability Matrix](docs/blueprint-traceability.md)
- [Architecture Decision Records](docs/adr/)
