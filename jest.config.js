// @ts-check
// jest.config.js

import { createDefaultEsmPreset } from 'ts-jest';

/** @type {import('ts-jest').DefaultEsmPreset} */
const presetConfig = createDefaultEsmPreset({
  tsconfig: './tsconfig.jest.json',
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
const jestConfig = {
  ...presetConfig,
  testEnvironment: 'node',
  cacheDirectory: '<rootDir>/.cache/jest',
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testMatch: ['**/src/**/*.{spec,test}.{ts,mts,cts}', '**/test/**/*.{spec,test}.{ts,mts,cts}'],
  testPathIgnorePatterns: ['/.cache/', '/coverage/', '/dist/', '/node_modules/', '/vitest/'],
  collectCoverageFrom: ['**/src/module.ts'],
  coverageDirectory: 'coverage/jest',
  coverageReporters: ['lcov', 'text', 'json'],
  coveragePathIgnorePatterns: ['/.cache/', '/coverage/', '/dist/', '/node_modules/', '/vitest/', '/src/.*\\.d\\.ts$'],
  maxWorkers: '100%',
};

export default jestConfig;
