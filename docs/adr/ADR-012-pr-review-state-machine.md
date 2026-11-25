# ADR-012: 12-State Pull Request Review Lifecycle, Stale-SHA Guard, and Human Approval

- **Status:** Accepted
- **Date:** 2026-11-25
- **Phase:** Phase 2

## Decision

Model every automated PR review across 12 explicit lifecycle states (`QUEUED`, `FETCHING_CONTEXT`, `ANALYZING`, `VALIDATING`, `AWAITING_APPROVAL`, `COMPLETED`, `COMPLETED_WITH_WARNINGS`, `PUBLISHED`, `REJECTED`, `FAILED`, `CANCELLED`, `SUPERSEDED`) anchored uniquely to `(workspace_id, pull_request_id, head_sha, policy_version)`. Validate all AI findings against real changed files and diff line bounds, require human approval when configured, re-verify the live PR head SHA before GitHub comment publication, and reconcile durable `review_comments.publication_key` markers to guarantee zero duplicate comments.
