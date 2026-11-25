-- Migration Group 008: Job Processing and Transactional Outbox

CREATE TABLE `analysis_jobs` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NULL,
    `job_type` ENUM('REPO_SYNC', 'REPO_INDEX', 'PR_REVIEW', 'PR_PUBLISH', 'SECURITY_SCAN', 'ARCHITECTURE_SCAN', 'TEST_GENERATION') NOT NULL,
    `idempotency_key` VARCHAR(200) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED') NOT NULL DEFAULT 'QUEUED',
    `priority` INTEGER NOT NULL DEFAULT 5,
    `payload_json` JSON NOT NULL,
    `result_json` JSON NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `worker_id` VARCHAR(128) NULL,
    `locked_until` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `next_run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `analysis_jobs_status_next_run_idx`(`status`, `next_run_at`),
    INDEX `analysis_jobs_ws_created_idx`(`workspace_id`, `created_at` DESC, `id`),
    INDEX `analysis_jobs_created_by_idx`(`created_by_user_id`),
    UNIQUE INDEX `analysis_jobs_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `analysis_jobs_ws_idempotency_key`(`workspace_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `job_attempts` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `attempt_number` INTEGER NOT NULL,
    `worker_id` VARCHAR(128) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `error_code` VARCHAR(64) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `duration_ms` INTEGER NULL,

    INDEX `job_attempts_ws_job_attempt_idx`(`workspace_id`, `job_id`, `attempt_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `outbox_events` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `aggregate_type` VARCHAR(64) NOT NULL,
    `aggregate_id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `dedupe_key` VARCHAR(200) NOT NULL,
    `payload_json` JSON NOT NULL,
    `status` ENUM('PENDING', 'DISPATCHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dispatched_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `outbox_events_dedupe_key_key`(`dedupe_key`),
    INDEX `outbox_events_status_next_attempt_idx`(`status`, `next_attempt_at`),
    INDEX `outbox_events_ws_created_idx`(`workspace_id`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `analysis_jobs` ADD CONSTRAINT `analysis_jobs_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `analysis_jobs` ADD CONSTRAINT `analysis_jobs_created_by_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `job_attempts` ADD CONSTRAINT `job_attempts_ws_job_fkey` FOREIGN KEY (`workspace_id`, `job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `outbox_events` ADD CONSTRAINT `outbox_events_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
