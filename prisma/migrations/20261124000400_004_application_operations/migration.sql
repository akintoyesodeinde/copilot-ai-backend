-- Migration Group 004: Application Operations (workspace_settings, usage_limits, audit_logs, notifications)

CREATE TABLE `workspace_settings` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `default_ai_provider` VARCHAR(64) NOT NULL DEFAULT 'mock',
    `allowed_ai_providers_json` JSON NOT NULL,
    `require_human_approval` BOOLEAN NOT NULL DEFAULT true,
    `auto_review_enabled` BOOLEAN NOT NULL DEFAULT false,
    `data_retention_days` INTEGER NOT NULL DEFAULT 90,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workspace_settings_workspace_id_key`(`workspace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `usage_limits` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `monthly_ai_budget_usd` DECIMAL(12, 4) NOT NULL DEFAULT 25.0000,
    `max_monthly_tokens` INTEGER NOT NULL DEFAULT 2000000,
    `max_repositories` INTEGER NOT NULL DEFAULT 25,
    `max_members` INTEGER NOT NULL DEFAULT 25,
    `current_month_tokens` INTEGER NOT NULL DEFAULT 0,
    `current_month_spend_usd` DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
    `period_start_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usage_limits_workspace_id_key`(`workspace_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(120) NOT NULL,
    `resource_type` VARCHAR(64) NOT NULL,
    `resource_id` VARCHAR(128) NULL,
    `outcome` ENUM('SUCCESS', 'FAILURE', 'DENIED') NOT NULL,
    `correlation_id` VARCHAR(64) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_workspace_created_id_idx`(`workspace_id`, `created_at` DESC, `id`),
    INDEX `audit_logs_actor_created_idx`(`actor_user_id`, `created_at` DESC),
    INDEX `audit_logs_action_created_idx`(`action`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `link_path` VARCHAR(255) NULL,
    `metadata_json` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_ws_user_created_id_idx`(`workspace_id`, `user_id`, `created_at` DESC, `id`),
    INDEX `notifications_user_read_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `workspace_settings` ADD CONSTRAINT `workspace_settings_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `usage_limits` ADD CONSTRAINT `usage_limits_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `notifications` ADD CONSTRAINT `notifications_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
