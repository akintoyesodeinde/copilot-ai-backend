-- Migration Group 015: Performance Indexes & Retention Policy Metadata

ALTER TABLE `audit_logs`
    ADD COLUMN `retention_expires_at` DATETIME(3) NULL;

ALTER TABLE `github_webhook_events`
    ADD COLUMN `retention_expires_at` DATETIME(3) NULL;

ALTER TABLE `ai_requests`
    ADD COLUMN `retention_expires_at` DATETIME(3) NULL;

CREATE INDEX `audit_logs_retention_idx` ON `audit_logs`(`retention_expires_at`);
CREATE INDEX `github_webhook_events_retention_idx` ON `github_webhook_events`(`retention_expires_at`);
CREATE INDEX `ai_requests_retention_idx` ON `ai_requests`(`retention_expires_at`);
CREATE INDEX `vulnerabilities_ws_status_sev_idx` ON `vulnerabilities`(`workspace_id`, `status`, `severity`, `created_at` DESC);
CREATE INDEX `code_reviews_ws_status_created_idx` ON `code_reviews`(`workspace_id`, `status`, `created_at` DESC);
CREATE INDEX `analysis_jobs_ws_type_status_idx` ON `analysis_jobs`(`workspace_id`, `job_type`, `status`);
