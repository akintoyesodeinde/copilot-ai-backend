# CodePilot AI — MySQL 8.4 Entity-Relationship Diagram (43 Tables / 15 Migration Groups)

All schema changes are governed by 15 ordered, version-controlled Prisma SQL migrations (`20261124000100_001_identity` through `20261125001500_015_performance_and_integrity`), verified with zero drift in CI (`prisma migrate diff --exit-code`).

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o{ refresh_tokens : rotates
    users ||--o{ workspace_members : belongs_to
    workspaces ||--o{ workspace_members : contains
    workspaces ||--|| workspace_settings : configures
    workspaces ||--|| usage_limits : enforces
    workspaces ||--o{ audit_logs : records
    workspaces ||--o{ notifications : delivers
    workspaces ||--o{ github_installations : owns
    workspaces ||--o{ repositories : owns
    github_installations ||--o{ repositories : syncs

    repositories ||--o{ repository_branches : tracks
    repositories ||--o{ repository_commits : tracks
    repositories ||--o{ pull_requests : receives
    pull_requests ||--o{ pull_request_files : modifies

    repositories ||--o{ repository_indexes : snapshots
    repository_indexes ||--o{ repository_files : stores
    repository_files ||--o{ code_symbols : extracts
    repository_files ||--o{ code_chunks : indexes_fulltext
    repository_indexes ||--o{ code_dependencies : links

    workspaces ||--o{ analysis_jobs : schedules
    analysis_jobs ||--o{ job_attempts : retries
    workspaces ||--o{ outbox_events : dispatches

    prompt_versions ||--o{ ai_requests : versions
    ai_requests ||--|| ai_usage_records : meters

    pull_requests ||--o{ code_reviews : generates
    code_reviews ||--o{ review_findings : contains
    code_reviews ||--o{ review_comments : publishes
    review_findings ||--o{ review_feedback : rates

    repositories ||--o{ security_scans : scans
    security_scans ||--o{ vulnerabilities : discovers
    security_scans ||--o{ dependency_packages : audits
    vulnerabilities ||--o{ risk_acceptances : approves_risk

    repositories ||--o{ architecture_scans : graphs
    architecture_scans ||--o{ architecture_nodes : nodes
    architecture_scans ||--o{ architecture_edges : edges
    architecture_scans ||--o{ architecture_violations : flags

    workspaces ||--o{ ai_conversations : hosts
    ai_conversations ||--o{ ai_messages : exchanges

    repositories ||--o{ test_generation_jobs : generates
    test_generation_jobs ||--o{ generated_tests : outputs
    generated_tests ||--o{ test_execution_results : validates_syntax
```

## Migration Group Inventory

| Group | Migration Directory                            | Purpose                                                                                                   |
| ----- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 001   | `20261124000100_001_identity`                  | `users`, `user_identities`, `sessions`, `refresh_tokens`                                                  |
| 002   | `20261124000200_002_multi_tenancy`             | `workspaces`, `workspace_members`, `workspace_invitations`                                                |
| 003   | `20261124000300_003_authorization`             | `roles`, `permissions`, `role_permissions`                                                                |
| 004   | `20261124000400_004_application_operations`    | `workspace_settings`, `usage_limits`, `audit_logs`, `notifications`                                       |
| 005   | `20261124000500_005_repository_foundation`     | `github_installations`, `repositories`, `repository_branches`, `repository_commits`                       |
| 006   | `20261125000600_006_github_and_pull_requests`  | `github_webhook_events`, `pull_requests`, `pull_request_files`                                            |
| 007   | `20261125000700_007_code_intelligence`         | `repository_indexes`, `repository_files`, `code_symbols`, `code_chunks` (`FULLTEXT`), `code_dependencies` |
| 008   | `20261125000800_008_job_processing`            | `analysis_jobs`, `job_attempts`, `outbox_events`                                                          |
| 009   | `20261125000900_009_ai_infrastructure`         | `prompt_versions`, `ai_requests`, `ai_usage_records`                                                      |
| 010   | `20261125001000_010_automated_reviews`         | `code_reviews`, `review_findings`, `review_comments`, `review_feedback`                                   |
| 011   | `20261125001100_011_security_intelligence`     | `security_scans`, `vulnerabilities`, `dependency_packages`, `risk_acceptances`                            |
| 012   | `20261125001200_012_architecture_intelligence` | `architecture_scans`, `architecture_nodes`, `architecture_edges`, `architecture_violations`               |
| 013   | `20261125001300_013_ai_conversations`          | `ai_conversations`, `ai_messages`                                                                         |
| 014   | `20261125001400_014_automated_testing`         | `test_generation_jobs`, `generated_tests`, `test_execution_results`                                       |
| 015   | `20261125001500_015_performance_and_integrity` | Retention expiry columns (`retention_expires_at`) and composite performance indexes                       |
