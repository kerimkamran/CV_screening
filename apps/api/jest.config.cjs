/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.spec.ts', '!src/testing/**'],
  coverageDirectory: 'coverage',
  // PLAT-03: merge is blocked if coverage falls below the agreed floor.
  coverageThreshold: { global: { statements: 85, branches: 75, functions: 85, lines: 85 } },
};
