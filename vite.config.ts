// vite.config.ts

// This Vitest configuration is designed for a TypeScript project.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['vitest/**/*.{spec,test}.{ts,mts,cts}'],
    exclude: ['dist', 'node_modules'],
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    environment: 'node',
    maxWorkers: 100,
    coverage: {
      provider: 'v8', // default, but explicit
      reporter: ['text', 'lcov'],
      include: ['src/constants.ts', 'src/mapParser.ts', 'src/mova.ts', 'src/platform.ts', 'src/module.ts'],
      exclude: [
        // Exclude test files that may live under src
        'src/**/*.test.{ts,tsx,js,jsx}',
        'src/**/*.spec.{ts,tsx,js,jsx}',
        // Exclude type declaration files
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 98,
        lines: 95,
      },
    },
  },
});
