# ADR-009: Amazon SQS, Dead-Letter Queues, and Idempotent Independent Workers

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 2

## Decision

Never execute repository synchronization, AST indexing, or AI inference inside Next.js HTTP route handlers. Dispatch jobs through a transactional outbox to Amazon SQS (`@aws-sdk/client-sqs`, with ElasticMQ locally and in-memory transport in isolated unit/CI tests) consumed by an independent Node.js worker process (`src/worker/index.ts`, `Dockerfile.worker`) enforcing `(workspace_id, idempotency_key)` uniqueness, optimistic worker locks, heartbeats, exponential backoff retries, stale lock recovery, and dead-letter queues.
