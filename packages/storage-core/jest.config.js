/** @type {import('jest').Config} */
module.exports = {
  displayName: 'storage-core',
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Test file patterns
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.spec.ts'],

  // Transform configuration
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },

  // Module resolution
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // Coverage configuration
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__tests__/**/*', '!src/index.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Setup and teardown
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Custom serializers for handling large objects
  snapshotSerializers: ['<rootDir>/../../test-utils/jest-serializer.js'],

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};
