module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/tests/performance/**/*.test.ts'],
  testTimeout: 600000, // 10 minute default timeout for performance tests
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  maxWorkers: 1, // Run performance tests sequentially
  
  // Setup files
  globalSetup: '<rootDir>/tests/integration/jest.global-setup.ts',
  globalTeardown: '<rootDir>/tests/integration/jest.global-teardown.ts',
  
  // Coverage
  collectCoverage: false,
  
  // Module resolution
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },
  
  // Transform
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  
  // Reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './test-results/performance',
        outputName: 'junit.xml',
      },
    ],
  ],
};
