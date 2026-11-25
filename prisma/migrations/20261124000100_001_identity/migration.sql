-- Migration Group 001: Identity (users, user_identities, sessions, refresh_tokens)

CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(150) NOT NULL,
    `avatar_url` VARCHAR(500) NULL,
    `is_platform_admin` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `email_verified_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_identities` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `provider_account_id` VARCHAR(191) NOT NULL,
    `provider_username` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_identities_user_id_idx`(`user_id`),
    UNIQUE INDEX `user_identities_provider_account_key`(`provider`, `provider_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `session_token_hash` CHAR(64) NOT NULL,
    `csrf_token_hash` CHAR(64) NOT NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_active_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_token_hash_key`(`session_token_hash`),
    INDEX `sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `replaced_by_id` CHAR(36) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    INDEX `refresh_tokens_session_id_idx`(`session_id`),
    INDEX `refresh_tokens_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
