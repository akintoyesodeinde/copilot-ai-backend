-- Migration Group 013: Repository-Aware AI Assistant Conversations

CREATE TABLE `ai_conversations` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NULL,
    `commit_sha` CHAR(40) NULL,
    `user_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_conversations_ws_id_key`(`workspace_id`, `id`),
    INDEX `ai_conversations_ws_user_updated_idx`(`workspace_id`, `user_id`, `updated_at` DESC),
    INDEX `ai_conversations_ws_repo_idx`(`workspace_id`, `repository_id`),
    INDEX `ai_conversations_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_messages` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `conversation_id` CHAR(36) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT', 'SYSTEM') NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `citations_json` JSON NULL,
    `ai_request_id` CHAR(36) NULL,
    `tokens_used` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_ws_conv_created_idx`(`workspace_id`, `conversation_id`, `created_at`),
    INDEX `ai_messages_ai_request_idx`(`ai_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_conversations`
    ADD CONSTRAINT `ai_conversations_workspace_id_fkey`
    FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_conversations`
    ADD CONSTRAINT `ai_conversations_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_conversations`
    ADD CONSTRAINT `ai_conversations_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_messages`
    ADD CONSTRAINT `ai_messages_ws_conv_fkey`
    FOREIGN KEY (`workspace_id`, `conversation_id`) REFERENCES `ai_conversations`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_messages`
    ADD CONSTRAINT `ai_messages_ai_request_fkey`
    FOREIGN KEY (`ai_request_id`) REFERENCES `ai_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
