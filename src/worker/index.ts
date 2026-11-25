import fs from 'node:fs';
import os from 'node:os';
import { getEnv } from '@/config/env';
import { disconnectPrisma } from '@/shared/database/prisma';
import { getLogger } from '@/shared/logging/logger';
import { runWorkerTick } from '@/modules/jobs/application/worker-engine';

if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

const workerId = `codepilot-worker-${os.hostname()}-${process.pid}`;
let shuttingDown = false;

async function main(): Promise<void> {
  const env = getEnv();
  const logger = getLogger().child({ workerId });

  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      githubMode: env.GITHUB_MODE,
      aiDefaultProvider: env.AI_DEFAULT_PROVIDER,
    },
    'Starting CodePilot AI independent background worker process',
  );

  const handleShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker received shutdown signal; draining active tasks');
  };

  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  process.once('SIGINT', () => handleShutdown('SIGINT'));

  while (!shuttingDown) {
    try {
      const stats = await runWorkerTick(workerId);
      if (stats.recovered > 0 || stats.outboxDispatched > 0 || stats.messagesProcessed > 0) {
        logger.info(stats, 'Worker tick processed asynchronous workload');
      }
    } catch (error) {
      logger.error({ err: error }, 'Worker tick encountered unexpected error');
    }

    if (!shuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
    }
  }

  await disconnectPrisma();
  logger.info('CodePilot AI background worker stopped cleanly');
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal worker startup error:', error);
  process.exit(1);
});
