-- Migration Group 010: Automated Pull Request Reviews

CREATE TABLE `code_reviews` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `pull_request_id` CHAR(36) NOT NULL,
    `head_sha` CHAR(40) NOT NULL,
    `policy_version` VARCHAR(32) NOT NULL DEFAULT 'v1',
    `status` ENUM('QUEUED', 'FETCHING_CONTEXT', 'ANALYZING', 'VALIDATING', 'AWAITING_APPROVAL', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'PUBLISHED', 'REJECTED', 'FAILED', 'CANCELLED', 'SUPERSEDED') NOT NULL DEFAULT 'QUEUED',
    `analysis_job_id` CHAR(36) NULL,
    `summary_markdown` MEDIUMTEXT NULL,
    `overall_risk` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NULL,
    `findings_count` INTEGER NOT NULL DEFAULT 0,
    `rejected_findings_count` INTEGER NOT NULL DEFAULT 0,
    `requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `approved_by_user_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `rejected_by_user_id` CHAR(36) NULL,
    `rejected_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `published_by_user_id` CHAR(36) NULL,
    `published_at` DATETIME(3) NULL,
    `github_review_id` BIGINT NULL,
    `publication_idempotency_key` VARCHAR(200) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `code_reviews_pub_idempotency_key`(`publication_idempotency_key`),
    INDEX `code_reviews_ws_repo_created_idx`(`workspace_id`, `repository_id`, `created_at` DESC),
    INDEX `code_reviews_ws_job_idx`(`workspace_id`, `analysis_job_id`),
    INDEX `code_reviews_approved_by_idx`(`approved_by_user_id`),
    INDEX `code_reviews_rejected_by_idx`(`rejected_by_user_id`),
    INDEX `code_reviews_published_by_idx`(`published_by_user_id`),
    UNIQUE INDEX `code_reviews_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `code_reviews_ws_pr_sha_policy_key`(`workspace_id`, `pull_request_id`, `head_sha`, `policy_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_findings` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `code_review_id` CHAR(36) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `source` ENUM('DETERMINISTIC', 'AI') NOT NULL,
    `severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO') NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `suggestion` TEXT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `start_line` INTEGER NOT NULL,
    `end_line` INTEGER NOT NULL,
    `evidence_snippet` TEXT NULL,
    `confidence` DECIMAL(4, 3) NULL,
    `is_published` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `review_findings_ws_review_sev_idx`(`workspace_id`, `code_review_id`, `severity`),
    UNIQUE INDEX `review_findings_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `review_findings_ws_review_fp_key`(`workspace_id`, `code_review_id`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_comments` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `code_review_id` CHAR(36) NOT NULL,
    `finding_id` CHAR(36) NULL,
    `publication_key` VARCHAR(200) NOT NULL,
    `github_comment_id` BIGINT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `line_number` INTEGER NOT NULL,
    `body_markdown` TEXT NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `review_comments_publication_key_key`(`publication_key`),
    INDEX `review_comments_ws_review_idx`(`workspace_id`, `code_review_id`),
    INDEX `review_comments_ws_finding_idx`(`workspace_id`, `finding_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `review_feedback` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `finding_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `vote` ENUM('HELPFUL', 'NOT_HELPFUL', 'FALSE_POSITIVE') NOT NULL,
    `comment` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `review_feedback_user_id_idx`(`user_id`),
    UNIQUE INDEX `review_feedback_ws_finding_user_key`(`workspace_id`, `finding_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_ws_repo_fkey` FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_ws_pr_fkey` FOREIGN KEY (`workspace_id`, `pull_request_id`) REFERENCES `pull_requests`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_ws_job_fkey` FOREIGN KEY (`workspace_id`, `analysis_job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_approved_by_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_rejected_by_fkey` FOREIGN KEY (`rejected_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `code_reviews` ADD CONSTRAINT `code_reviews_published_by_fkey` FOREIGN KEY (`published_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `review_findings` ADD CONSTRAINT `review_findings_ws_review_fkey` FOREIGN KEY (`workspace_id`, `code_review_id`) REFERENCES `code_reviews`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `review_comments` ADD CONSTRAINT `review_comments_ws_review_fkey` FOREIGN KEY (`workspace_id`, `code_review_id`) REFERENCES `code_reviews`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `review_comments` ADD CONSTRAINT `review_comments_ws_finding_fkey` FOREIGN KEY (`workspace_id`, `finding_id`) REFERENCES `review_findings`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `review_feedback` ADD CONSTRAINT `review_feedback_ws_finding_fkey` FOREIGN KEY (`workspace_id`, `finding_id`) REFERENCES `review_findings`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `review_feedback` ADD CONSTRAINT `review_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
