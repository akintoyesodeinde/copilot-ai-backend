# ADR-010: Tree-sitter WASM Indexing, MySQL Full-Text Retrieval, and Private S3 Artifacts

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 2

## Decision

Parse repository source files at specific commit SHAs using `web-tree-sitter` WASM grammars (`@vscode/tree-sitter-wasm`) without executing untrusted repository code or compiling native C++ toolchains per platform. Enforce path-traversal guards and exclude binaries, dependencies, lockfiles, oversized files, and sensitive configuration files. Persist code chunks in MySQL 8.4 with a `FULLTEXT` index (`code_chunks_content_ft_idx`) for cost-effective tenant-scoped RAG and store full index artifacts encrypted in private Amazon S3.
