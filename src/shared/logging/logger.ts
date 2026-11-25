import pino, { type Logger } from 'pino';
import { getEnv } from '@/config/env';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.sessionToken',
  '*.refreshToken',
  '*.csrfToken',
  '*.secret',
  '*.privateKey',
  '*.apiKey',
];

let rootLogger: Logger | null = null;

export function getLogger(): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const env = getEnv();
  rootLogger = pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: {
      service: env.OTEL_SERVICE_NAME,
      env: env.NODE_ENV,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return rootLogger;
}

export function createRequestLogger(correlationId: string): Logger {
  return getLogger().child({ correlationId });
}
