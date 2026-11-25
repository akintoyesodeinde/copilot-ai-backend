-- Migration Group 003: Authorization (roles, permissions, role_permissions + role foreign keys)

CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `scope` ENUM('PLATFORM', 'WORKSPACE') NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `resource` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    INDEX `permissions_resource_action_idx`(`resource`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_role_key_fkey` FOREIGN KEY (`role_key`) REFERENCES `roles`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `workspace_invitations` ADD CONSTRAINT `workspace_invitations_role_key_fkey` FOREIGN KEY (`role_key`) REFERENCES `roles`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;
