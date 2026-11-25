-- Migration Group 005: Repository Foundation (github_installations, repositories, repository_branches, repository_commits)

CREATE TABLE `github_installations` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `github_installation_id` BIGINT NOT NULL,
    `account_login` VARCHAR(191) NOT NULL,
    `account_type` VARCHAR(32) NOT NULL,
    `target_type` VARCHAR(32) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `permissions_json` JSON NULL,
    `installed_by_user_id` CHAR(36) NULL,
    `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `github_installations_gh_id_key`(`github_installation_id`),
    INDEX `github_installations_workspace_status_idx`(`workspace_id`, `status`),
    INDEX `github_installations_installed_by_idx`(`installed_by_user_id`),
    UNIQUE INDEX `github_installations_workspace_id_id_key`(`workspace_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `repositories` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `github_installation_id` CHAR(36) NULL,
    `github_repo_id` BIGINT NOT NULL,
    `owner_login` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(384) NOT NULL,
    `description` VARCHAR(500) NULL,
    `default_branch` VARCHAR(128) NOT NULL DEFAULT 'main',
    `visibility` ENUM('PUBLIC', 'PRIVATE', 'INTERNAL') NOT NULL DEFAULT 'PRIVATE',
    `primary_language` VARCHAR(64) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `access_revoked_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `repositories_ws_active_created_id_idx`(`workspace_id`, `is_active`, `created_at` DESC, `id`),
    INDEX `repositories_ws_gh_installation_idx`(`workspace_id`, `github_installation_id`),
    UNIQUE INDEX `repositories_workspace_id_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `repositories_workspace_gh_repo_key`(`workspace_id`, `github_repo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `repository_branches` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `head_sha` CHAR(40) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_protected` BOOLEAN NOT NULL DEFAULT false,
    `last_commit_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `repository_branches_ws_repo_idx`(`workspace_id`, `repository_id`),
    UNIQUE INDEX `repository_branches_ws_repo_name_key`(`workspace_id`, `repository_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `repository_commits` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `sha` CHAR(40) NOT NULL,
    `message_headline` VARCHAR(255) NOT NULL,
    `author_name` VARCHAR(150) NOT NULL,
    `author_email` VARCHAR(255) NULL,
    `committed_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `repository_commits_ws_repo_committed_idx`(`workspace_id`, `repository_id`, `committed_at` DESC),
    UNIQUE INDEX `repository_commits_ws_repo_sha_key`(`workspace_id`, `repository_id`, `sha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `github_installations` ADD CONSTRAINT `github_installations_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `github_installations` ADD CONSTRAINT `github_installations_installed_by_fkey` FOREIGN KEY (`installed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `repositories` ADD CONSTRAINT `repositories_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `repositories` ADD CONSTRAINT `repositories_ws_gh_installation_fkey` FOREIGN KEY (`workspace_id`, `github_installation_id`) REFERENCES `github_installations`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `repository_branches` ADD CONSTRAINT `repository_branches_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `repository_commits` ADD CONSTRAINT `repository_commits_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
