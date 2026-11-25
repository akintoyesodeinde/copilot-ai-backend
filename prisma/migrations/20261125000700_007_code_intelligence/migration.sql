-- Migration Group 007: Code Intelligence (repository_indexes, repository_files, code_symbols, code_chunks, code_dependencies)

CREATE TABLE `repository_indexes` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `status` ENUM('QUEUED', 'INDEXING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `files_indexed` INTEGER NOT NULL DEFAULT 0,
    `symbols_extracted` INTEGER NOT NULL DEFAULT 0,
    `chunks_created` INTEGER NOT NULL DEFAULT 0,
    `s3_artifact_key` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `repository_indexes_ws_repo_created_idx`(`workspace_id`, `repository_id`, `created_at` DESC),
    UNIQUE INDEX `repository_indexes_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `repository_indexes_ws_repo_sha_key`(`workspace_id`, `repository_id`, `commit_sha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `repository_files` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `index_id` CHAR(36) NOT NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `language` VARCHAR(64) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `line_count` INTEGER NOT NULL,
    `content_hash` CHAR(64) NOT NULL,
    `content_preview` MEDIUMTEXT NULL,
    `s3_object_key` VARCHAR(500) NULL,
    `is_excluded` BOOLEAN NOT NULL DEFAULT false,
    `exclusion_reason` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `repository_files_ws_index_idx`(`workspace_id`, `index_id`),
    INDEX `repository_files_ws_repo_lang_idx`(`workspace_id`, `repository_id`, `language`),
    UNIQUE INDEX `repository_files_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `repository_files_ws_repo_sha_path_key`(`workspace_id`, `repository_id`, `commit_sha`, `file_path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `code_symbols` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `signature` VARCHAR(500) NULL,
    `start_line` INTEGER NOT NULL,
    `end_line` INTEGER NOT NULL,
    `exported` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `code_symbols_ws_repo_sha_kind_idx`(`workspace_id`, `repository_id`, `commit_sha`, `kind`),
    INDEX `code_symbols_ws_file_idx`(`workspace_id`, `file_id`),
    INDEX `code_symbols_ws_repo_name_idx`(`workspace_id`, `repository_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `code_chunks` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `start_line` INTEGER NOT NULL,
    `end_line` INTEGER NOT NULL,
    `symbol_name` VARCHAR(255) NULL,
    `language` VARCHAR(64) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `token_estimate` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `code_chunks_ws_repo_sha_idx`(`workspace_id`, `repository_id`, `commit_sha`),
    UNIQUE INDEX `code_chunks_ws_file_chunk_key`(`workspace_id`, `file_id`, `chunk_index`),
    FULLTEXT INDEX `code_chunks_content_ft_idx`(`content`, `file_path`, `symbol_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `code_dependencies` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `index_id` CHAR(36) NOT NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `source_file_path` VARCHAR(400) NOT NULL,
    `target_specifier` VARCHAR(400) NOT NULL,
    `resolved_target_path` VARCHAR(400) NULL,
    `dependency_type` VARCHAR(32) NOT NULL,
    `line_number` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `code_dependencies_ws_repo_sha_idx`(`workspace_id`, `repository_id`, `commit_sha`),
    INDEX `code_dependencies_ws_index_idx`(`workspace_id`, `index_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `repository_indexes` ADD CONSTRAINT `repository_indexes_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `repository_files` ADD CONSTRAINT `repository_files_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `repository_files` ADD CONSTRAINT `repository_files_ws_index_fkey` FOREIGN KEY (`workspace_id`, `index_id`) REFERENCES `repository_indexes`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_symbols` ADD CONSTRAINT `code_symbols_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_symbols` ADD CONSTRAINT `code_symbols_ws_file_fkey` FOREIGN KEY (`workspace_id`, `file_id`) REFERENCES `repository_files`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_chunks` ADD CONSTRAINT `code_chunks_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_chunks` ADD CONSTRAINT `code_chunks_ws_file_fkey` FOREIGN KEY (`workspace_id`, `file_id`) REFERENCES `repository_files`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_dependencies` ADD CONSTRAINT `code_dependencies_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_dependencies` ADD CONSTRAINT `code_dependencies_ws_index_fkey` FOREIGN KEY (`workspace_id`, `index_id`) REFERENCES `repository_indexes`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
