/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  testTimeout: 30000,
  forceExit: true,
  // Run suites serially — rate-limiter test floods requests to the shared
  // Redis rate-limit counter, which would corrupt concurrent test suites.
  maxWorkers: 1,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 80,
    },
  },
};
