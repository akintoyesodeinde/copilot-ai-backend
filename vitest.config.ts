import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
  },
});
