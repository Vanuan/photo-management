/** @type {import('jest').Config} */
const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  
  // Only run storage-service integration tests
  projects: [
    '<rootDir>/packages/storage-service'
  ],
  
  // Disable coverage for integration tests
  collectCoverage: false,
  
  // Remove coverage thresholds
  coverageThreshold: undefined,
  
  // Integration tests should not run in parallel
  maxWorkers: 1,
};
