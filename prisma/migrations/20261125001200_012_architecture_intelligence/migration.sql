-- Migration Group 012: Software Architecture Intelligence

CREATE TABLE `architecture_scans` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `repository_id` CHAR(36) NOT NULL,
    `analysis_job_id` CHAR(36) NULL,
    `commit_sha` CHAR(40) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `nodes_count` INTEGER NOT NULL DEFAULT 0,
    `edges_count` INTEGER NOT NULL DEFAULT 0,
    `circular_deps_count` INTEGER NOT NULL DEFAULT 0,
    `violations_count` INTEGER NOT NULL DEFAULT 0,
    `orphan_modules_count` INTEGER NOT NULL DEFAULT 0,
    `metrics_json` JSON NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `architecture_scans_ws_id_key`(`workspace_id`, `id`),
    INDEX `architecture_scans_ws_repo_created_idx`(`workspace_id`, `repository_id`, `created_at` DESC),
    INDEX `architecture_scans_ws_job_idx`(`workspace_id`, `analysis_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `architecture_nodes` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `scan_id` CHAR(36) NOT NULL,
    `node_key` VARCHAR(400) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(400) NOT NULL,
    `layer` VARCHAR(64) NOT NULL,
    `module_group` VARCHAR(128) NOT NULL,
    `language` VARCHAR(64) NOT NULL,
    `lines_of_code` INTEGER NOT NULL DEFAULT 0,
    `fan_in` INTEGER NOT NULL DEFAULT 0,
    `fan_out` INTEGER NOT NULL DEFAULT 0,
    `instability` DECIMAL(5, 4) NOT NULL DEFAULT 0.0000,
    `is_orphan` BOOLEAN NOT NULL DEFAULT false,
    `is_hotspot` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `architecture_nodes_ws_id_key`(`workspace_id`, `id`),
    UNIQUE INDEX `architecture_nodes_ws_scan_key_key`(`workspace_id`, `scan_id`, `node_key`),
    INDEX `architecture_nodes_ws_scan_layer_idx`(`workspace_id`, `scan_id`, `layer`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `architecture_edges` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `scan_id` CHAR(36) NOT NULL,
    `source_node_id` CHAR(36) NOT NULL,
    `target_node_id` CHAR(36) NOT NULL,
    `edge_type` VARCHAR(32) NOT NULL DEFAULT 'import',
    `is_circular` BOOLEAN NOT NULL DEFAULT false,
    `is_violation` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `architecture_edges_ws_scan_idx`(`workspace_id`, `scan_id`),
    INDEX `architecture_edges_ws_source_idx`(`workspace_id`, `source_node_id`),
    INDEX `architecture_edges_ws_target_idx`(`workspace_id`, `target_node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `architecture_violations` (
    `id` CHAR(36) NOT NULL,
    `workspace_id` CHAR(36) NOT NULL,
    `scan_id` CHAR(36) NOT NULL,
    `violation_type` ENUM('CIRCULAR_DEPENDENCY', 'LAYER_BOUNDARY', 'HIGH_COUPLING', 'ORPHAN_MODULE') NOT NULL,
    `severity` ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO') NOT NULL,
    `rule_name` VARCHAR(128) NOT NULL,
    `message` TEXT NOT NULL,
    `source_path` VARCHAR(400) NOT NULL,
    `target_path` VARCHAR(400) NULL,
    `cycle_paths_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `architecture_violations_ws_scan_type_idx`(`workspace_id`, `scan_id`, `violation_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `architecture_scans`
    ADD CONSTRAINT `architecture_scans_ws_repo_fkey`
    FOREIGN KEY (`workspace_id`, `repository_id`) REFERENCES `repositories`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `architecture_scans`
    ADD CONSTRAINT `architecture_scans_ws_job_fkey`
    FOREIGN KEY (`workspace_id`, `analysis_job_id`) REFERENCES `analysis_jobs`(`workspace_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `architecture_nodes`
    ADD CONSTRAINT `architecture_nodes_ws_scan_fkey`
    FOREIGN KEY (`workspace_id`, `scan_id`) REFERENCES `architecture_scans`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `architecture_edges`
    ADD CONSTRAINT `architecture_edges_ws_scan_fkey`
    FOREIGN KEY (`workspace_id`, `scan_id`) REFERENCES `architecture_scans`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `architecture_edges`
    ADD CONSTRAINT `architecture_edges_ws_source_fkey`
    FOREIGN KEY (`workspace_id`, `source_node_id`) REFERENCES `architecture_nodes`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `architecture_edges`
    ADD CONSTRAINT `architecture_edges_ws_target_fkey`
    FOREIGN KEY (`workspace_id`, `target_node_id`) REFERENCES `architecture_nodes`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `architecture_violations`
    ADD CONSTRAINT `architecture_violations_ws_scan_fkey`
    FOREIGN KEY (`workspace_id`, `scan_id`) REFERENCES `architecture_scans`(`workspace_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
