import { z } from 'zod';
import { ValidationError } from '@/shared/http/problem-details';

const cursorPayloadSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export interface CursorToken {
  id: string;
  createdAt: Date;
}

export interface PaginationParams {
  limit: number;
  cursor: CursorToken | null;
}

export interface PaginationMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export function encodeCursor(item: { id: string; createdAt: Date }): string {
  const json = JSON.stringify({
    id: item.id,
    createdAt: item.createdAt.toISOString(),
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorToken {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = cursorPayloadSchema.parse(JSON.parse(decoded));
    return {
      id: parsed.id,
      createdAt: new Date(parsed.createdAt),
    };
  } catch {
    throw new ValidationError('Invalid pagination cursor', [
      { field: 'cursor', message: 'Cursor is malformed or expired' },
    ]);
  }
}

export function parsePaginationParams(
  url: URL,
  defaultLimit = 20,
  maxLimit = 100,
): PaginationParams {
  const rawLimit = url.searchParams.get('limit');
  let limit = defaultLimit;

  if (rawLimit !== null && rawLimit !== '') {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxLimit) {
      throw new ValidationError(`limit must be an integer between 1 and ${maxLimit}`, [
        { field: 'limit', message: `Must be between 1 and ${maxLimit}` },
      ]);
    }
    limit = parsed;
  }

  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;

  return { limit, cursor };
}

export function paginateDescByCreatedAt<T extends { id: string; createdAt: Date }>(
  records: T[],
  limit: number,
): { items: T[]; pagination: PaginationMeta } {
  const hasMore = records.length > limit;
  const items = hasMore ? records.slice(0, limit) : records;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null;

  return {
    items,
    pagination: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}
