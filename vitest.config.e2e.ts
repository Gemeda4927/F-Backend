import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 60000,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
