-- Migration Group 002: Multi-tenancy (workspaces, workspace_members, workspace_invitations)

CREATE TABLE `workspaces` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `plan_tier` VARCHAR(32) NOT NULL DEFAULT 'SANDBOX',
    `created_by_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `archived_at` DATETIME(3) NULL,

    UNIQUE INDEX `workspaces_slug_key`(`slug`),
    INDEX `workspaces_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace_members` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_key` VARCHAR(64) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workspace_members_user_id_status_idx`(`user_id`, `status`),
    INDEX `workspace_members_role_key_idx`(`role_key`),
    UNIQUE INDEX `workspace_members_workspace_user_key`(`workspace_id`, `user_id`),
    UNIQUE INDEX `workspace_members_workspace_id_id_key`(`workspace_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace_invitations` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role_key` VARCHAR(64) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `invited_by_user_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workspace_invitations_token_hash_key`(`token_hash`),
    INDEX `workspace_invitations_ws_email_status_idx`(`workspace_id`, `email`, `status`),
    INDEX `workspace_invitations_invited_by_idx`(`invited_by_user_id`),
    INDEX `workspace_invitations_role_key_idx`(`role_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_invitations` ADD CONSTRAINT `workspace_invitations_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_invitations` ADD CONSTRAINT `workspace_invitations_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
