-- Migration Group 014: AI Automated Test Generation

CREATE TABLE `test_generation_jobs` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `analysis_job_id` CHAR(36) NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `target_file_path` VARCHAR(400) NOT NULL,
    `language` VARCHAR(64) NOT NULL,
    `framework` VARCHAR(64) NOT NULL,
    `test_types_json` JSON NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `created_by_user_id` CHAR(36) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `test_generation_jobs_ws_id_key`(`workspace_id`, `id`),
    INDEX `test_generation_jobs_ws_repo_created_idx`(`workspace_id`, `repository_id`, `created_at` DESC),
    INDEX `test_generation_jobs_ws_job_idx`(`workspace_id`, `analysis_job_id`),
    INDEX `test_generation_jobs_created_by_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generated_tests` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `test_generation_job_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `target_file_path` VARCHAR(400) NOT NULL,
    `suggested_test_path` VARCHAR(400) NOT NULL,
    `language` VARCHAR(64) NOT NULL,
    `framework` VARCHAR(64) NOT NULL,
    `test_type` ENUM('UNIT', 'INTEGRATION', 'REGRESSION', 'SECURITY') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `test_code` MEDIUMTEXT NOT NULL,
    `boundary_conditions_json` JSON NULL,
    `syntax_valid` BOOLEAN NOT NULL DEFAULT false,
    `syntax_errors_json` JSON NULL,
    `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `generated_tests_ws_id_key`(`workspace_id`, `id`),
    INDEX `generated_tests_ws_job_idx`(`workspace_id`, `test_generation_job_id`),
    INDEX `generated_tests_ws_repo_approval_idx`(`workspace_id`, `repository_id`, `approval_status`),
    INDEX `generated_tests_approved_by_idx`(`approved_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `test_execution_results` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `generated_test_id` CHAR(36) NOT NULL,
    `validation_engine` VARCHAR(64) NOT NULL,
    `syntax_passed` BOOLEAN NOT NULL,
    `diagnostics_json` JSON NULL,
    `sandbox_executed` BOOLEAN NOT NULL DEFAULT false,
    `summary` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `test_execution_results_ws_test_idx`(`workspace_id`, `generated_test_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `test_generation_jobs`
    ADD CONSTRAINT `test_generation_jobs_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `test_generation_jobs`
    ADD CONSTRAINT `test_generation_jobs_ws_job_fkey`
    FOREIGN KEY (`workspace_id`, `analysis_job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `test_generation_jobs`
    ADD CONSTRAINT `test_generation_jobs_created_by_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `generated_tests`
    ADD CONSTRAINT `generated_tests_ws_job_fkey`
    FOREIGN KEY (`workspace_id`, `test_generation_job_id`) REFERENCES `test_generation_jobs`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `generated_tests`
    ADD CONSTRAINT `generated_tests_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `generated_tests`
    ADD CONSTRAINT `generated_tests_approved_by_fkey`
    FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `test_execution_results`
    ADD CONSTRAINT `test_execution_results_ws_test_fkey`
    FOREIGN KEY (`workspace_id`, `generated_test_id`) REFERENCES `generated_tests`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
