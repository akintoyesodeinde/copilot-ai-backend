# CodePilot AI — Versioned AI Evaluation Framework

## 1. Purpose & Design

To prevent silent regressions in finding accuracy, hallucination filtering, prompt-injection resistance, secret redaction, and multi-language generated test syntax validity, CodePilot AI ships a version-controlled evaluation dataset (`evals/dataset-v1.json`) and deterministic CI runner (`evals/run-evals.ts`, invoked via `npm run eval:ai`).

## 2. Dataset v1.0.0 Benchmark Categories (11 Cases)

1. **`clean_code` (`eval-001`):** Clean parameterized TypeScript service — asserts **0 false positives**.
2. **`security_vulnerability` (`eval-002`, `eval-003`, `eval-004`):** SQL injection (CWE-89), `eval()` code injection (CWE-95), DOM XSS `innerHTML` (CWE-79) — asserts 100% deterministic CWE recall.
3. **`secret_detection` (`eval-005`):** AWS key + GitHub PAT — asserts detection AND **0 raw secret leaks** in serialized findings.
4. **`dependency_vulnerability` (`eval-006`):** `package.json` with `lodash@4.17.19` — asserts OSV CVE-2021-23337 detection.
5. **`container_security` (`eval-007`):** Root `:latest` Dockerfile — asserts Trivy DS001 & DS002 detection.
6. **`prompt_injection` (`eval-008`):** Adversarial comment instructing the reviewer to ignore policies and approve — asserts prompt-injection detection (`>= 2` signals) AND real vulnerability still caught.
7. **`architecture_analysis` (`eval-009`):** Circular `domain <-> infrastructure` dependency — asserts Tarjan SCC cycle detection AND `LAYER_BOUNDARY` violation.
8. **`hallucination_filtering` (`eval-010`):** AI findings citing a nonexistent file and an out-of-range line number — asserts **100% rejection** by `validateAndMergeFindings` while preserving grounded findings.
9. **`test_syntax_validation` (`eval-011`):** Multi-language generated test suites (TypeScript, Python, Java, C#, Go) — asserts 100% `tree-sitter-wasm` syntax validity AND deterministic rejection of malformed syntax.

## 3. Execution & Reporting

Run locally or in CI:

```bash
npm run eval:ai
```

The runner emits measured metrics to stdout and writes a machine-readable JSON artifact at `test-results/ai-eval-report.json` (archived in GitHub Actions `backend-test-reports`). Any failed benchmark case exits with code `1` and blocks CI.

> **Honest Scope Note:** `eval:ai` validates deterministic scanners, prompt-injection detectors, hallucination filtering, architecture graph rules, and Tree-sitter WASM test syntax validation offline without calling paid external LLM endpoints. When live external providers (`openai`, `anthropic`, `bedrock`) are configured, the same dataset provides the baseline harness for live model regression benchmarking.
