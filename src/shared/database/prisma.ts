import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@/generated/prisma/client';
import { getEnv } from '@/config/env';

declare global {
  var __codepilotPrisma: PrismaClient | undefined;
}

function buildAdapter(databaseUrl: string): PrismaMariaDb {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get('ssl-mode')?.toLowerCase();
  const useTls = sslMode === 'required' || sslMode === 'verify_ca' || sslMode === 'verify_identity';

  return new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    allowPublicKeyRetrieval: !useTls,
    ssl: useTls ? { rejectUnauthorized: sslMode === 'verify_identity' } : undefined,
  });
}

export function getPrisma(): PrismaClient {
  if (!globalThis.__codepilotPrisma) {
    const env = getEnv();
    const adapter = buildAdapter(env.DATABASE_URL);
    globalThis.__codepilotPrisma = new PrismaClient({ adapter });
  }
  return globalThis.__codepilotPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (globalThis.__codepilotPrisma) {
    await globalThis.__codepilotPrisma.$disconnect();
    globalThis.__codepilotPrisma = undefined;
  }
}
