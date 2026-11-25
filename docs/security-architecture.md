# CodePilot AI — Application Security & Scanning Architecture

## 1. Deterministic vs. Advisory AI Separation

CodePilot AI strictly separates deterministic static security findings (`source: DETERMINISTIC`) from advisory AI observations (`source: AI_ADVISORY`):

- Deterministic scanners (**Semgrep SAST rules**, **Gitleaks secret detector**, **OSV dependency auditor**, **ESLint security rules**, and **Trivy container/IaC checks**) execute asynchronously in `SECURITY_SCAN` worker jobs.
- Advisory AI outputs can explain vulnerabilities or recommend refactors, but can **never** overwrite, delete, or downgrade deterministic scanner findings.

## 2. Secret Redaction Guarantee

When Gitleaks or any SAST rule matches potential credentials (AWS Access Keys, GitHub PATs, Stripe keys, PEM private keys, high-entropy credential assignments), the matched literal is redacted **before** database insertion (`redacted_snippet`) and **before** any AI prompt assembly or Pino log emission. Plaintext secrets are never persisted in `vulnerabilities`, `ai_requests`, or logs.

## 3. Triage & Time-Bound Risk Acceptance Governance

- `VIEWER`: Read-only access to workspace vulnerabilities and security analytics.
- `DEVELOPER`: Can trigger security scans and triage vulnerabilities (`OPEN`, `TRIAGED`, `FALSE_POSITIVE`, `FIXED`).
- `WORKSPACE_OWNER`: Exclusively authorized (`workspace:update`) to record formal `risk_acceptances`, requiring a written rationale, optional mitigating controls, and a mandatory **future expiration timestamp**. Every triage and risk acceptance writes an immutable `audit_logs` entry.
- `PLATFORM_ADMIN`: Can access `GET /api/v1/admin/overview` for anonymized platform-level operational metrics (`tenantCodeAccessGranted: false`), but is **explicitly denied** (`403 Forbidden`) access to private tenant repositories, source code, and tenant vulnerability records.

## 4. Zero Untrusted Code Execution

Neither repository AST indexing (`web-tree-sitter` WASM) nor AI Test Studio syntax verification (`validateSourceSyntaxWithTreeSitter` with `sandboxExecuted: false`) ever executes untrusted repository scripts, package postinstall hooks, or generated test code on the API or worker host.

## 5. Supply-Chain & HTTP Hardening

- Strict HTTP security headers on all API responses (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`).
- CI gates enforce `npm audit --omit=dev --audit-level=high` (0 high/critical vulnerabilities) and generate a CycloneDX Software Bill of Materials (`test-results/sbom-cyclonedx.json`) archived with every CI run.
