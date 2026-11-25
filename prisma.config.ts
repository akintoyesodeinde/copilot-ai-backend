import fs from 'node:fs';
import { defineConfig } from 'prisma/config';

if (fs.existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'mysql://codepilot:codepilot_dev_password@127.0.0.1:3306/codepilot_ai',
  },
});
