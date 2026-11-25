# CodePilot AI — AI Orchestration, Indexing & Review Pipeline

## 1. Safe Repository Indexing (`src/modules/indexing/`)

- **Zero Untrusted Code Execution:** Repository files are parsed strictly as data using `web-tree-sitter` WASM grammars (`@vscode/tree-sitter-wasm`) for TypeScript, TSX, JavaScript, Python, Go, Java, C#, Rust, C++, PHP, and Ruby. Untrusted repository scripts, builds, or tests are never executed on the API or worker host.
- **Path & Secret Exclusion Guard (`path-guard.ts`):** Rejects path traversal (`..`), absolute paths, null bytes, `.git/`, `node_modules/`, `dist/`, `build/`, `vendor/`, `.env*`, private keys (`*.pem`, `*.key`, `BEGIN ... PRIVATE KEY`), binary files, and oversized files (>256 KB).
- **Commit-SHA Incremental Storage:** Indexed snapshots are keyed by `(workspace_id, repository_id, commit_sha)`. Files whose SHA-256 content hash matches an existing indexed record skip redundant AST re-parsing.
- **Storage & Retrieval:** Raw indexed file artifacts and manifests are uploaded to private AES-256 encrypted Amazon S3 buckets (`s3-storage.ts`, with an in-memory fallback in local test mode). Extracted AST symbols, dependencies, and chunked source windows are stored in MySQL 8.4 (`repository_files`, `code_symbols`, `code_chunks`, `code_dependencies`) with a MySQL `FULLTEXT` index on `code_chunks(content, file_path, symbol_name)` for tenant-scoped, commit-scoped RAG retrieval.

## 2. Provider-Agnostic AI Orchestration (`src/modules/ai/`)

- **Supported Adapters:** `OpenAiProviderAdapter`, `AnthropicProviderAdapter`, `BedrockProviderAdapter` (AWS SDK v3 `@aws-sdk/client-bedrock-runtime`), and deterministic `MockAiProviderAdapter` for offline tests/CI.
- **Tenant Provider Allowlist & Budget Controls:** Every AI invocation validates the requested provider against `workspace_settings.allowed_ai_providers_json` and enforces `usage_limits.monthly_ai_budget_usd`, `usage_limits.max_monthly_tokens`, and per-request token limits before calling any model.
- **Prompt Injection Defense & Secret Redaction:**
  - High-entropy API keys, AWS credentials, GitHub tokens, Bearer headers, and PEM private keys are redacted before prompt construction.
  - Untrusted repository code, PR titles, descriptions, and diffs are enclosed inside `<UNTRUSTED_REPOSITORY_DATA>` delimiters and accompanied by explicit system prompt instructions forbidding instruction override.
  - Prompt-injection heuristics (`detectPromptInjectionSignals`) flag suspicious payloads for telemetry and audit inspection.
- **Structured Output Validation & Resilience:** Model responses must satisfy strict Zod schemas (`structuredPrReviewOutputSchema`). A per-provider circuit breaker (`aiCircuitBreaker`) plus bounded exponential backoff retries protect workers from cascading provider failures. Every request records tokens, latency, prompt version, status, and USD cost in `ai_requests` and `ai_usage_records`.

## 3. Automated Pull Request Review Lifecycle (`src/modules/reviews/`)

Every PR review follows a strictly enforced 12-state machine (`state-machine.ts`):

```text
QUEUED -> FETCHING_CONTEXT -> CONTEXT_READY -> ANALYZING -> VALIDATING_FINDINGS
       -> AWAITING_APPROVAL | COMPLETED -> PUBLISHING -> PUBLISHED
Terminal/Exceptional States: PARTIAL_SUCCESS, FAILED, STALE, CANCELLED
```

### Hybrid Deterministic + AI Finding Verification (`finding-validator.ts`)

1. **Deterministic Diff Checks:** Static pattern checks inspect added diff lines for dangerous patterns (SQL string interpolation, `eval()`, `innerHTML` sinks, `Math.random()` token generation, hardcoded credentials) independently of the LLM.
2. **Hallucination Filtering:** Every AI-proposed finding is verified against the actual PR changed files and diff line bounds. Findings referencing nonexistent files or out-of-range lines are dropped and counted in `rejected_findings_count`.
3. **Deduplication:** Surviving findings are fingerprinted via SHA-256 and deduplicated before persistence into `review_findings`.
4. **Human Governance & Feedback:** Developers and owners can inspect findings, submit `HELPFUL` / `FALSE_POSITIVE` / `OUTDATED` feedback (`POST /api/v1/findings/:id/feedback`), approve or reject reviews, and explicitly trigger GitHub publishing.
