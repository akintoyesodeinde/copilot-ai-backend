import type { Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/shared/database/prisma';
import { NotFoundError } from '@/shared/http/problem-details';
import {
  paginateDescByCreatedAt,
  type PaginationMeta,
  type PaginationParams,
} from '@/shared/http/pagination';

export interface NotificationDto {
  id: string;
  workspaceId: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listWorkspaceNotifications(
  workspaceId: string,
  userId: string,
  pagination: PaginationParams,
  unreadOnly = false,
): Promise<{
  items: NotificationDto[];
  unreadCount: number;
  pagination: PaginationMeta;
}> {
  const prisma = getPrisma();

  const where: Prisma.NotificationWhereInput = {
    workspaceId,
    userId,
    ...(unreadOnly ? { readAt: null } : {}),
    ...(pagination.cursor
      ? {
          OR: [
            { createdAt: { lt: pagination.cursor.createdAt } },
            {
              createdAt: pagination.cursor.createdAt,
              id: { lt: pagination.cursor.id },
            },
          ],
        }
      : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    }),
    prisma.notification.count({
      where: { workspaceId, userId, readAt: null },
    }),
  ]);

  const paged = paginateDescByCreatedAt(rows, pagination.limit);

  return {
    items: paged.items.map((n) => ({
      id: n.id,
      workspaceId: n.workspaceId,
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      linkPath: n.linkPath,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
    pagination: paged.pagination,
  };
}

export async function markNotificationRead(
  workspaceId: string,
  userId: string,
  notificationId: string,
): Promise<NotificationDto> {
  const prisma = getPrisma();
  const existing = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      workspaceId,
      userId,
    },
  });

  if (!existing) {
    throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
  }

  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: existing.readAt ?? new Date() },
  });

  return {
    id: updated.id,
    workspaceId: updated.workspaceId,
    type: updated.type,
    severity: updated.severity,
    title: updated.title,
    body: updated.body,
    linkPath: updated.linkPath,
    readAt: updated.readAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}
