import { getPrisma } from '@/shared/database/prisma';

const startedAt = Date.now();

export function getLivenessStatus() {
  return {
    status: 'ok' as const,
    service: 'codepilot-ai-backend',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
}

export async function getReadinessStatus() {
  const dbStart = Date.now();
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    return {
      ready: true,
      status: 'ready' as const,
      checks: {
        database: {
          status: 'up' as const,
          latencyMs: Date.now() - dbStart,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      ready: false,
      status: 'degraded' as const,
      checks: {
        database: {
          status: 'down' as const,
          latencyMs: Date.now() - dbStart,
        },
      },
      timestamp: new Date().toISOString(),
    };
  }
}
