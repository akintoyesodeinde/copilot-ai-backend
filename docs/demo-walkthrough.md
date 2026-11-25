# CodePilot AI — 20-Step End-to-End Sandbox Demonstration Guide

This walkthrough demonstrates every verified capability of **CodePilot AI — Intelligent Code Review Platform** end-to-end.

1. **Landing Page & Theme Toggle:** Open `/` (`http://localhost:3000` or deployed sandbox URL); verify all 6 capability badges (`Live — Phase 1/2/3`) and toggle dark/light theme cleanly.
2. **Account Registration & Session Cookies:** Navigate to `/register`, create a new account (or sign in at `/login` with seeded Owner `owner@acme-synthetic.dev` / `CodePilot!Dev2026`); verify `cp_session` & `cp_refresh` HttpOnly cookies and `cp_csrf` token.
3. **Multi-Tenant Workspace Switching:** Open the top-left workspace switcher in `DashboardShell`; verify active `X-Workspace-Id` scoping and role label (`Workspace Owner`).
4. **Engineering Overview Dashboard:** Inspect `/dashboard` — verify real MySQL KPIs (repositories, open PRs, completed reviews, members), language distribution chart, and workspace monthly AI spend bar.
5. **RBAC Team & Invitations:** Visit `/team`, invite a colleague as `DEVELOPER` or `VIEWER`, and verify role-restricted actions disappear for `VIEWER` accounts.
6. **Workspace Security & AI Policies:** Visit `/settings`, verify `requireHumanApproval = true`, provider allowlist (`mock`, `openai`, `anthropic`, `bedrock`), monthly USD/token limits, and data retention days.
7. **GitHub App Integration:** Visit `/integrations`, inspect least-privilege scopes (`contents:read`, `metadata:read`, `pull_requests:write`, `checks:write`), and connect a GitHub App installation (fixture mode or live GitHub App).
8. **Repository Sync & Tree-sitter Indexing:** Open `/repositories` -> click `payments-ledger-service` -> trigger `Sync Repository` and `Index Codebase` (`HTTP 202` queued asynchronously).
9. **Background Jobs Console:** Visit `/jobs` to observe `REPO_SYNC` / `REPO_INDEX` job status, attempt count, and completion timestamps.
10. **Monaco Source & AST Symbol Explorer:** Return to `/repositories/[id]`, browse indexed TypeScript files in read-only Monaco Editor (note `.env.production`, `node_modules/`, and binary PNGs are strictly excluded), and filter extracted AST symbols.
11. **Pull Request List & Unified Diff Viewer:** Open `/pull-requests`, select PR #42, and inspect syntax-aligned diff hunks in `UnifiedDiffViewer`.
12. **Automated AI PR Review:** Click `Run Automated Review` (`POST /api/v1/pull-requests/:id/reviews`), wait for worker execution, and inspect deterministic + AI findings with severity/category filters.
13. **Finding Feedback, Human Approval & GitHub Publish:** Submit `HELPFUL` / `FALSE_POSITIVE` feedback on a finding, click `Approve Review`, and click `Publish to GitHub` (demonstrates stale head-SHA check and duplicate comment reconciliation).
14. **Deterministic Security Scanning:** Navigate to `/security`, click `Run Security Scan`, and inspect Semgrep (SQLi/eval), Gitleaks (verify raw AWS key is strictly redacted!), OSV-Scanner (`lodash@4.17.19` CVE-2021-23337), and Trivy (`Dockerfile` DS001/DS002) findings.
15. **Security Triage & Owner-Only Risk Acceptance:** Triage a finding to `TRIAGED`, then click `Accept Risk` as `WORKSPACE_OWNER` with justification and 30-day expiry (verify `DEVELOPER` receives `403`).
16. **Interactive React Flow Architecture Explorer:** Open `/architecture`, click `Run Architecture Scan`, pan/zoom the layered React Flow dependency graph, click a node to inspect fan-in/fan-out/Martin instability, and review detected Tarjan SCC circular dependencies and `domain-no-infrastructure` violations.
17. **Advisory AI Coding Assistant (SSE + Citations):** Visit `/assistant`, start a repository session, ask about `executeLedgerTransfer`, observe streamed SSE tokens and verified `file:line` citations, then test an autonomous mutation request (`push to main`) to observe strict advisory read-only refusal.
18. **AI Test Studio (Zero Host Execution):** Visit `/test-studio`, select `src/ledger/transfer-service.ts` (TypeScript/Vitest or Python/pytest/Go), click `Generate Tests`, preview generated code in Monaco with `Syntax Verified (WASM AST)` + `Zero Host Execution`, approve, and download the test file.
19. **Engineering Analytics & AI Spend:** Inspect `/analytics` (transparent Code Health Score formula, scanner breakdown, review feedback precision) and `/ai-usage` (token/USD breakdown by provider and purpose).
20. **Immutable Audit Logs & Platform Admin Boundary:** Inspect `/audit-logs` for full chronological security traceability, then sign in as Platform Admin (`admin@codepilot-platform.dev`) to view `/admin` (`Tenant Code Access: DENIED BY DESIGN`) while confirming `403 Forbidden` on private tenant repositories.
