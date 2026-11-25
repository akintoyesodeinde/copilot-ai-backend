# ADR-013: Deterministic Security Scanning Separated from Advisory AI

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 3

## Decision

Run deterministic application security scanners (Semgrep-compatible SAST rules, Gitleaks secret detection with mandatory pre-persistence secret redaction, OSV dependency CVE auditing, ESLint security rules, and Trivy container/IaC checks) inside asynchronous worker jobs (`SECURITY_SCAN`) and store all results tagged `source: DETERMINISTIC`. Advisory AI insights are strictly separated (`AI_ADVISORY`) and can never overwrite, suppress, or downgrade deterministic vulnerability findings. Triage is permitted for `DEVELOPER` and `WORKSPACE_OWNER`, while time-bound risk acceptances with future expiration dates require `WORKSPACE_OWNER` and full audit logging.
