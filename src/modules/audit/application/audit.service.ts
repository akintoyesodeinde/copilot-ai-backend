import { getPrisma } from '@/shared/database/prisma';
import { getLogger } from '@/shared/logging/logger';
import type { Prisma } from '@/generated/prisma/client';
import {
  paginateDescByCreatedAt,
  type PaginationMeta,
  type PaginationParams,
} from '@/shared/http/pagination';

export interface RecordAuditInput {
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_METADATA_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'sessionToken',
  'refreshToken',
  'csrfToken',
  'secret',
  'privateKey',
  'apiKey',
  'authorization',
  'cookie',
]);

function sanitizeMetadata(metadata?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (!metadata) {
    return undefined;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key)) {
      clean[key] = '[REDACTED]';
    } else if (value !== undefined) {
      clean[key] = value;
    }
  }
  return clean as Prisma.InputJsonValue;
}

export async function recordAuditEvent(input: RecordAuditInput): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome,
        correlationId: input.correlationId,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadataJson: sanitizeMetadata(input.metadata),
      },
    });
  } catch (error) {
    getLogger().error(
      { err: error, action: input.action, correlationId: input.correlationId },
      'Failed to persist audit log event',
    );
  }
}

export interface AuditLogItemDto {
  id: string;
  workspaceId: string | null;
  actorUserId: string | null;
  actor: {
    id: string;
    email: string;
    fullName: string;
  } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  correlationId: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function listWorkspaceAuditLogs(
  workspaceId: string,
  pagination: PaginationParams,
  filters?: { action?: string; outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED' },
): Promise<{ items: AuditLogItemDto[]; pagination: PaginationMeta }> {
  const prisma = getPrisma();

  const where: Prisma.AuditLogWhereInput = {
    workspaceId,
    ...(filters?.action ? { action: { contains: filters.action } } : {}),
    ...(filters?.outcome ? { outcome: filters.outcome } : {}),
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

  const rows = await prisma.auditLog.findMany({
    where,
    include: {
      actor: {
        select: {
          id: true,
          email: true,
          fullName: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
  });

  const paged = paginateDescByCreatedAt(rows, pagination.limit);

  return {
    items: paged.items.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      actorUserId: row.actorUserId,
      actor: row.actor,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      outcome: row.outcome,
      correlationId: row.correlationId,
      ipAddress: row.ipAddress,
      metadata:
        row.metadataJson && typeof row.metadataJson === 'object' && !Array.isArray(row.metadataJson)
          ? (row.metadataJson as Record<string, unknown>)
          : null,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: paged.pagination,
  };
}
