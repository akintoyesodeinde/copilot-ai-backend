# ADR-014: Deterministic Architecture Dependency Graph & Tarjan Cycle Analysis

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 3

## Decision

Construct software architecture dependency graphs deterministically from Tree-sitter AST extracted imports (`code_dependencies`) and indexed source files (`repository_files`) during asynchronous `ARCHITECTURE_SCAN` worker jobs. Classify modules into architectural layers (`presentation`, `application`, `domain`, `infrastructure`, `shared`, `tests`), detect circular dependencies using Tarjan's Strongly Connected Components (SCC) algorithm, evaluate configurable Dependency-Cruiser-compatible layer boundary rules, and compute fan-in, fan-out, Martin instability, orphan modules, and coupling hotspots for interactive React Flow visualization.
