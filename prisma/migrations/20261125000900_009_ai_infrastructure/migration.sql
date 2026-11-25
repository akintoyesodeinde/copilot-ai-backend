-- Migration Group 009: AI Infrastructure (prompt_versions, ai_requests, ai_usage_records)

CREATE TABLE `prompt_versions` (
    `id` CHAR(36) NOT NULL,
    `prompt_key` VARCHAR(100) NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `purpose` VARCHAR(64) NOT NULL,
    `system_prompt` TEXT NOT NULL,
    `user_template` TEXT NOT NULL,
    `output_schema_name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `prompt_versions_purpose_active_idx`(`purpose`, `is_active`),
    UNIQUE INDEX `prompt_versions_key_version_key`(`prompt_key`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_requests` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NULL,
    `analysis_job_id` CHAR(36) NULL,
    `prompt_version_id` CHAR(36) NULL,
    `provider` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NOT NULL,
    `purpose` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REJECTED_SCHEMA', 'BUDGET_EXCEEDED', 'CIRCUIT_OPEN') NOT NULL DEFAULT 'PENDING',
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `estimated_cost_usd` DECIMAL(12, 6) NOT NULL DEFAULT 0.000000,
    `latency_ms` INTEGER NOT NULL DEFAULT 0,
    `request_hash` CHAR(64) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_requests_ws_created_idx`(`workspace_id`, `created_at` DESC),
    INDEX `ai_requests_ws_job_idx`(`workspace_id`, `analysis_job_id`),
    INDEX `ai_requests_prompt_version_idx`(`prompt_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_records` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `ai_request_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NOT NULL,
    `purpose` VARCHAR(64) NOT NULL,
    `input_tokens` INTEGER NOT NULL,
    `output_tokens` INTEGER NOT NULL,
    `total_tokens` INTEGER NOT NULL,
    `cost_usd` DECIMAL(12, 6) NOT NULL,
    `billing_period` VARCHAR(7) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_usage_records_ai_request_id_key`(`ai_request_id`),
    INDEX `ai_usage_records_ws_period_idx`(`workspace_id`, `billing_period`, `recorded_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_requests` ADD CONSTRAINT `ai_requests_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_requests` ADD CONSTRAINT `ai_requests_ws_job_fkey` FOREIGN KEY (`workspace_id`, `analysis_job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ai_requests` ADD CONSTRAINT `ai_requests_prompt_version_fkey` FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ai_usage_records` ADD CONSTRAINT `ai_usage_records_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_usage_records` ADD CONSTRAINT `ai_usage_records_ai_request_id_fkey` FOREIGN KEY (`ai_request_id`) REFERENCES `ai_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
