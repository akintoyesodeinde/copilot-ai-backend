-- Migration Group 006: GitHub Webhooks and Pull Requests

CREATE TABLE `github_webhook_events` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NULL,
    `github_delivery_id` VARCHAR(128) NOT NULL,
    `event_name` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NULL,
    `github_installation_id` BIGINT NULL,
    `github_repo_id` BIGINT NULL,
    `signature_valid` BOOLEAN NOT NULL,
    `processing_status` ENUM('RECEIVED', 'QUEUED', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `payload_json` JSON NOT NULL,
    `error_message` VARCHAR(500) NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    UNIQUE INDEX `github_webhook_events_delivery_id_key`(`github_delivery_id`),
    INDEX `github_webhook_events_ws_received_idx`(`workspace_id`, `received_at` DESC),
    INDEX `github_webhook_events_gh_install_idx`(`github_installation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pull_requests` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `github_pr_id` BIGINT NOT NULL,
    `pr_number` INTEGER NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `state` ENUM('OPEN', 'CLOSED', 'MERGED') NOT NULL DEFAULT 'OPEN',
    `author_login` VARCHAR(191) NOT NULL,
    `base_branch` VARCHAR(255) NOT NULL,
    `head_branch` VARCHAR(255) NOT NULL,
    `base_sha` CHAR(40) NOT NULL,
    `head_sha` CHAR(40) NOT NULL,
    `is_draft` BOOLEAN NOT NULL DEFAULT false,
    `additions` INTEGER NOT NULL DEFAULT 0,
    `deletions` INTEGER NOT NULL DEFAULT 0,
    `changed_files_count` INTEGER NOT NULL DEFAULT 0,
    `html_url` VARCHAR(500) NULL,
    `merged_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pull_requests_ws_state_created_idx`(`workspace_id`, `state`, `created_at` DESC, `id`),
    UNIQUE INDEX `pull_requests_workspace_id_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `pull_requests_ws_repo_number_key`(`workspace_id`, `repository_id`, `pr_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pull_request_files` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `pull_request_id` CHAR(36) NOT NULL,
    `head_sha` CHAR(40) NOT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `previous_file_path` VARCHAR(400) NULL,
    `status` VARCHAR(32) NOT NULL,
    `additions` INTEGER NOT NULL DEFAULT 0,
    `deletions` INTEGER NOT NULL DEFAULT 0,
    `patch` LONGTEXT NULL,
    `blob_sha` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pull_request_files_ws_pr_sha_idx`(`workspace_id`, `pull_request_id`, `head_sha`),
    UNIQUE INDEX `pull_request_files_ws_pr_sha_path_key`(`workspace_id`, `pull_request_id`, `head_sha`, `file_path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `github_webhook_events` ADD CONSTRAINT `github_webhook_events_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pull_requests` ADD CONSTRAINT `pull_requests_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `pull_request_files` ADD CONSTRAINT `pull_request_files_ws_pr_fkey` FOREIGN KEY (`workspace_id`, `pull_request_id`) REFERENCES `pull_requests`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
