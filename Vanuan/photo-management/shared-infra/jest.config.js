/** @type {import('jest').Config} */
module.exports = {
  // Root workspace configuration
  projects: [
    '<rootDir>/packages/storage-core',
    '<rootDir>/packages/storage-client',
    '<rootDir>/packages/storage-service'
  ],

  // Coverage collection across all packages
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary',
    'clover'
  ],

  // Global coverage thresholds
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    },
    './packages/storage-core/': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './packages/storage-client/': {
      branches: 75,
      functions: 75,
      lines: 75,
      statements: 75
    },
    './packages/storage-service/': {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Test execution settings
  maxWorkers: '50%',
  testTimeout: 30000,
  verbose: true,
  passWithNoTests: true,

  // Error handling
  bail: false,
  errorOnDeprecated: true,

  // Reporters for CI/CD integration
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'test-results',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ],

  // Watch mode settings
  watchman: true,
  watchPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.git/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/test-results/'
  ],

  // Global setup and teardown
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',

  // Notification settings (useful for development)
  notify: false,
  notifyMode: 'failure-change',

  // Cache settings
  cache: true,
  cacheDirectory: '<rootDir>/.jest-cache',

  // Test environment variables
  testEnvironment: 'node',

  // Global test patterns to ignore
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/test-results/',
    '<rootDir>/.jest-cache/'
  ],

  // Force exit after tests complete
  forceExit: false,

  // Detect open handles that prevent Jest from exiting
  detectOpenHandles: true,

  // Clear mocks automatically between every test
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false
};
