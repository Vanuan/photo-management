/** @type {import('jest').Config} */
module.exports = {
  displayName: 'storage-service',
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
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
    '!src/index.ts',
    '!src/server.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Setup and teardown
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Custom serializers for handling large objects
  snapshotSerializers: ['<rootDir>/../../test-utils/jest-serializer.js'],

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Integration test configuration
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist/', '<rootDir>/coverage/'],
};
