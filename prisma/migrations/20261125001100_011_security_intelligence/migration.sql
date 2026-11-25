-- Migration Group 011: Security Intelligence (SAST, Secret Scanning, Dependency Audits, Risk Acceptances)

CREATE TABLE `security_scans` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `analysis_job_id` CHAR(36) NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `scanners_run_json` JSON NULL,
    `findings_count` INTEGER NOT NULL DEFAULT 0,
    `critical_count` INTEGER NOT NULL DEFAULT 0,
    `high_count` INTEGER NOT NULL DEFAULT 0,
    `medium_count` INTEGER NOT NULL DEFAULT 0,
    `low_count` INTEGER NOT NULL DEFAULT 0,
    `summary_json` JSON NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `security_scans_ws_id_key`(`workspace_id`, `id`),
    INDEX `security_scans_ws_repo_created_idx`(`workspace_id`, `repository_id`, `created_at` DESC),
    INDEX `security_scans_ws_job_idx`(`workspace_id`, `analysis_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `vulnerabilities` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `security_scan_id` CHAR(36) NOT NULL,
    `scanner` ENUM('SEMGREP', 'GITLEAKS', 'OSV_SCANNER', 'ESLINT', 'TRIVY', 'AI_ADVISORY') NOT NULL,
    `source` ENUM('DETERMINISTIC', 'AI_ADVISORY') NOT NULL DEFAULT 'DETERMINISTIC',
    `rule_id` VARCHAR(128) NOT NULL,
    `cwe_id` VARCHAR(32) NULL,
    `cve_id` VARCHAR(32) NULL,
    `owasp_category` VARCHAR(64) NULL,
    `severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO') NOT NULL,
    `status` ENUM('OPEN', 'TRIAGED', 'FALSE_POSITIVE', 'RISK_ACCEPTED', 'FIXED') NOT NULL DEFAULT 'OPEN',
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NOT NULL,
    `remediation` TEXT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `start_line` INTEGER NOT NULL,
    `end_line` INTEGER NOT NULL,
    `redacted_snippet` TEXT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `triaged_by_user_id` CHAR(36) NULL,
    `triaged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vulnerabilities_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `vulnerabilities_ws_scan_fp_key`(`workspace_id`, `security_scan_id`, `fingerprint`),
    INDEX `vulnerabilities_ws_repo_sev_idx`(`workspace_id`, `repository_id`, `severity`),
    INDEX `vulnerabilities_triaged_by_idx`(`triaged_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `dependency_packages` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `security_scan_id` CHAR(36) NOT NULL,
    `ecosystem` VARCHAR(64) NOT NULL,
    `package_name` VARCHAR(255) NOT NULL,
    `version` VARCHAR(64) NOT NULL,
    `manifest_path` VARCHAR(400) NOT NULL,
    `is_direct` BOOLEAN NOT NULL DEFAULT true,
    `advisory_count` INTEGER NOT NULL DEFAULT 0,
    `highest_severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO') NULL,
    `fixed_version` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dependency_packages_ws_scan_idx`(`workspace_id`, `security_scan_id`),
    INDEX `dependency_packages_ws_repo_pkg_idx`(`workspace_id`, `repository_id`, `package_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `risk_acceptances` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `vulnerability_id` CHAR(36) NOT NULL,
    `accepted_by_user_id` CHAR(36) NULL,
    `reason` TEXT NOT NULL,
    `mitigating_controls` TEXT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_acceptances_ws_vuln_idx`(`workspace_id`, `vulnerability_id`),
    INDEX `risk_acceptances_accepted_by_idx`(`accepted_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `security_scans`
    ADD CONSTRAINT `security_scans_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `security_scans`
    ADD CONSTRAINT `security_scans_ws_job_fkey`
    FOREIGN KEY (`workspace_id`, `analysis_job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `vulnerabilities`
    ADD CONSTRAINT `vulnerabilities_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `vulnerabilities`
    ADD CONSTRAINT `vulnerabilities_ws_scan_fkey`
    FOREIGN KEY (`workspace_id`, `security_scan_id`) REFERENCES `security_scans`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `vulnerabilities`
    ADD CONSTRAINT `vulnerabilities_triaged_by_fkey`
    FOREIGN KEY (`triaged_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `dependency_packages`
    ADD CONSTRAINT `dependency_packages_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `dependency_packages`
    ADD CONSTRAINT `dependency_packages_ws_scan_fkey`
    FOREIGN KEY (`workspace_id`, `security_scan_id`) REFERENCES `security_scans`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `risk_acceptances`
    ADD CONSTRAINT `risk_acceptances_ws_vuln_fkey`
    FOREIGN KEY (`workspace_id`, `vulnerability_id`) REFERENCES `vulnerabilities`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `risk_acceptances`
    ADD CONSTRAINT `risk_acceptances_accepted_by_fkey`
    FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
