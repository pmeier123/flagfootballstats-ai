import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'scripts/**/*.test.ts', 'supabase/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000
  }
});

