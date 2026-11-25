# CodePilot AI — System Architecture

## 1. Standalone Two-Repository Architecture

CodePilot AI is engineered as two strictly decoupled standalone repositories (never a monorepo):

1. **Backend API & Worker (`akintoyesodeinde/copilot-ai-backend`):** Headless Next.js App Router REST API (`:4000`) + standalone Node.js background worker (`src/worker/index.ts`), Prisma ORM, MySQL 8.4 LTS, Amazon SQS/DLQ, Amazon S3, Tree-sitter WASM AST engine, deterministic security scanners, architecture analyzer, and provider-agnostic AI orchestrator.
2. **Frontend Dashboard (`akintoyesodeinde/codepilot-ai-frontend`):** Standalone React 19 + Next.js App Router dashboard (`:3000`) communicating strictly over HTTP `/api/v1/*` with HttpOnly cookie sessions, automatic CSRF header handling, Monaco Editor, unified diff viewer, and React Flow interactive architecture graphs.

## 2. High-Level System Architecture Diagram

```mermaid
flowchart LR
    User["Engineer / Workspace Owner / Platform Admin"] -->|HTTPS| Nginx["Nginx Reverse Proxy (TLS 1.2/1.3)"]
    GitHub["GitHub App & Webhooks"] -->|HMAC-SHA256 HTTPS| Nginx

    Nginx -->|"/*"| Frontend["Next.js Frontend (:3000)"]
    Nginx -->|"/api/v1/*"| Backend["Next.js Headless REST API (:4000)"]
    Frontend -->|"/api/v1/* proxy"| Backend

    Backend -->|"Prisma ORM (Composite Tenant FKs)"| RDS["Private Amazon RDS MySQL 8.4"]
    Backend -->|"Transactional Outbox"| RDS
    Worker["Standalone Node.js Worker"] -->|"Claim Jobs + Dispatch Outbox"| RDS
    Worker <-->|"Poll / Ack / DLQ"| SQS["Amazon SQS + DLQ"]
    Worker <-->|"Encrypted Index Artifacts"| S3["Private Amazon S3 (AES-256)"]
    Worker <-->|"Short-Lived Installation Tokens"| GitHub
    Worker <-->|"Budgeted Structured JSON"| AI["AI Providers (OpenAI / Anthropic / Bedrock / Mock)"]
```

## 3. Automated Pull Request Review Sequence

```mermaid
sequenceDiagram
    participant GH as GitHub Webhook
    participant API as Backend REST API
    participant DB as MySQL 8.4 (Outbox + Jobs)
    participant SQS as Amazon SQS
    participant W as Node.js Worker
    participant AI as AI Orchestrator

    GH->>API: POST /api/v1/webhooks/github (raw body + X-Hub-Signature-256)
    API->>API: timingSafeEqual HMAC + X-GitHub-Delivery dedupe
    API->>DB: Upsert PullRequest + AnalysisJob + OutboxEvent (atomic tx)
    API-->>GH: 202 Accepted
    W->>DB: Dispatch PENDING OutboxEvents -> SQS
    W->>SQS: Receive message (visibility timeout + heartbeat)
    W->>DB: Optimistic claim QUEUED -> RUNNING
    W->>GH: Fetch PR files & unified diff
    W->>DB: Retrieve commit-scoped MySQL FULLTEXT RAG chunks
    W->>AI: Redacted + <UNTRUSTED_REPOSITORY_DATA> prompt (budget + circuit breaker)
    AI-->>W: Zod-validated StructuredPrReviewOutput
    W->>W: Run deterministic diff checks + drop hallucinated paths/lines + SHA-256 dedupe
    W->>DB: Persist ReviewFindings + CodeReview (AWAITING_APPROVAL)
    Note over API,GH: Human approves review -> POST /api/v1/reviews/:id/publish checks live head SHA before posting reconciled comments
```

## 4. Multi-Tenant & Security Invariants

- Every tenant-owned record carries `workspace_id` and composite foreign keys (`(workspace_id, id)`).
- Untrusted repository source code is **never** executed on the API or worker host (`web-tree-sitter` WASM parsing only; AI Test Studio sets `sandboxExecuted: false`).
- `PLATFORM_ADMIN` accesses only aggregated operational telemetry (`GET /api/v1/admin/overview`, `tenantCodeAccessGranted: false`) and is denied (`403 Forbidden`) private tenant repository code and vulnerability details.
