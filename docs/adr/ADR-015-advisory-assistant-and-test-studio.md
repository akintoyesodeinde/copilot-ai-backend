# ADR-015: Strictly Advisory AI Assistant and Safe Zero-Execution AI Test Studio

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 3

## Decision

1. **Advisory-Only AI Assistant:** Restrict the repository-aware AI coding assistant to read-only analysis grounded in tenant-scoped, commit-scoped MySQL `FULLTEXT` retrieval. Verify every file/line citation against persisted `repository_files` rows, stream verified responses and citations via Server-Sent Events (`text/event-stream`), and explicitly refuse autonomous repository writes, merges, or shell execution requests.
2. **Zero-Execution AI Test Studio:** Support JavaScript/TypeScript (`vitest`/`jest`) as primary targets plus extensible adapters for Python (`pytest`), Java (`junit5`), C# (`xunit`), and Go (`testing`). Validate generated test syntax exclusively through `web-tree-sitter` WASM AST error-node inspection (`sandboxExecuted: false`) — never executing untrusted repository code on the API or worker host. Require explicit engineer approval before adoption.
