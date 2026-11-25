# ADR-001: Standalone Two-Repository Architecture

- **Status:** Accepted
- **Date:** 2026-11-24
- **Phase:** Phase 1

## Context

CodePilot AI must enforce clear operational, security, and deployment boundaries between the privileged REST API/background worker tier and the browser-facing React engineering dashboard.

## Decision

Maintain two independent GitHub repositories with separate dependency graphs, Dockerfiles, and CI/CD pipelines:

- Backend: `akintoyesodeinde/copilot-ai-backend` (local directory `codepilot-ai-backend`)
- Frontend: `akintoyesodeinde/codepilot-ai-frontend` (local directory `codepilot-ai-frontend`)

The frontend communicates exclusively with the backend over versioned HTTP REST APIs (`/api/v1/*`) and never connects directly to MySQL, GitHub App keys, or AI provider credentials.

## Consequences

- Independent CI quality gates and container images per tier.
- API contracts are explicitly versioned and published via OpenAPI 3.1 (`GET /api/v1/openapi.json`).
