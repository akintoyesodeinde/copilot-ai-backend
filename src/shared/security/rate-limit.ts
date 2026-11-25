import { RateLimitError } from '@/shared/http/problem-details';

interface WindowBucket {
  timestamps: number[];
}

const buckets = new Map<string, WindowBucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}

export function enforceRateLimit(options: RateLimitOptions): {
  remaining: number;
  resetAtMs: number;
} {
  const now = options.nowMs ?? Date.now();
  const cutoff = now - options.windowMs;

  if (buckets.size >= MAX_BUCKETS && !buckets.has(options.key)) {
    for (const [bucketKey, bucket] of buckets) {
      const latest = bucket.timestamps[bucket.timestamps.length - 1];
      if (!latest || latest <= cutoff) {
        buckets.delete(bucketKey);
      }
    }
  }

  const existing = buckets.get(options.key) ?? { timestamps: [] };
  existing.timestamps = existing.timestamps.filter((ts) => ts > cutoff);

  if (existing.timestamps.length >= options.limit) {
    const oldest = existing.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
    buckets.set(options.key, existing);
    throw new RateLimitError('Too many requests. Please wait before retrying.', retryAfterSeconds);
  }

  existing.timestamps.push(now);
  buckets.set(options.key, existing);

  const oldest = existing.timestamps[0] ?? now;
  return {
    remaining: Math.max(0, options.limit - existing.timestamps.length),
    resetAtMs: oldest + options.windowMs,
  };
}

export function clearRateLimitsForTesting(): void {
  buckets.clear();
}
