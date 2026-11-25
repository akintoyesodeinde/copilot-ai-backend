import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_NAME: z.string().min(1).default('CodePilot AI API'),
  APP_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((val) => val.startsWith('mysql://'), {
      message: 'DATABASE_URL must be a valid mysql:// connection string',
    }),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters long')
    .default('dev-only-insecure-session-secret-change-in-production-001'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  COOKIE_DOMAIN: z.string().optional().default(''),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).max(1000).default(5),
  RATE_LIMIT_REGISTER_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_SERVICE_NAME: z.string().min(1).default('codepilot-ai-backend'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
});

export type AppEnv = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & {
  COOKIE_SECURE: boolean;
};

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse({
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      (process.env.NODE_ENV === 'production'
        ? undefined
        : 'mysql://codepilot:codepilot_dev_password@127.0.0.1:3306/codepilot_ai'),
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.SESSION_SECRET.startsWith('dev-only-')) {
    throw new Error('SESSION_SECRET must be explicitly configured in production');
  }

  cachedEnv = {
    ...parsed.data,
    COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
  };

  return cachedEnv;
}

export function resetEnvCacheForTesting(): void {
  cachedEnv = null;
}
