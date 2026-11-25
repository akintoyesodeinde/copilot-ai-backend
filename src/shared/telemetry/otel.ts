import { NodeSDK } from '@opentelemetry/sdk-node';
import { getEnv } from '@/config/env';
import { getLogger } from '@/shared/logging/logger';
import { disconnectPrisma } from '@/shared/database/prisma';

let otelSdk: NodeSDK | null = null;
let shutdownHooksRegistered = false;

export function initializeTelemetry(): void {
  const env = getEnv();
  const logger = getLogger();

  if (env.OTEL_ENABLED && !otelSdk) {
    otelSdk = new NodeSDK({
      serviceName: env.OTEL_SERVICE_NAME,
    });
    otelSdk.start();
    logger.info({ service: env.OTEL_SERVICE_NAME }, 'OpenTelemetry SDK started');
  }

  registerGracefulShutdown();
}

export function registerGracefulShutdown(): void {
  if (shutdownHooksRegistered || typeof process === 'undefined') {
    return;
  }
  shutdownHooksRegistered = true;

  const shutdown = async (signal: string) => {
    const logger = getLogger();
    logger.info({ signal }, 'Received shutdown signal; closing resources');

    try {
      await disconnectPrisma();
      if (otelSdk) {
        await otelSdk.shutdown();
      }
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
