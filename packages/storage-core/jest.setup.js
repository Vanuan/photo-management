// Global test setup for storage-core package

// Import shared custom matchers
const { extendExpect } = require('../../test-utils/custom-matchers');

// Mock console methods to reduce noise during tests
const originalConsole = { ...console };

beforeAll(() => {
  // Mock console methods but keep the original functionality for debugging
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
  console.debug = jest.fn();
});

afterAll(() => {
  // Restore original console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
});

// Set up global test utilities
global.testUtils = {
  // Helper to create test buffers
  createTestBuffer: (size = 1024) => {
    return Buffer.alloc(size, 'test data');
  },

  // Helper to create mock photo data
  createMockPhoto: (overrides = {}) => {
    return {
      id: 'test-photo-id',
      s3_key: 'photos/test-photo-id/test.jpg',
      s3_url: 'https://localhost:9000/photos/test-photo-id/test.jpg',
      bucket: 'images',
      size: 1024,
      processing_status: 'completed',
      created_at: '2023-01-01T00:00:00.000Z',
      original_filename: 'test.jpg',
      mime_type: 'image/jpeg',
      client_id: 'test-client',
      uploaded_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
      ...overrides,
    };
  },

  // Helper to create mock store options
  createMockStoreOptions: (overrides = {}) => {
    return {
      originalName: 'test.jpg',
      contentType: 'image/jpeg',
      clientId: 'test-client',
      userId: 'test-user',
      sessionId: 'test-session',
      metadata: {
        source: 'test',
      },
      ...overrides,
    };
  },

  // Helper to wait for promises
  waitFor: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to create test dates
  createTestDate: (offset = 0) => {
    const baseDate = new Date('2023-01-01T00:00:00.000Z');
    return new Date(baseDate.getTime() + offset);
  },
};

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Suppress deprecation warnings during tests
process.noDeprecation = true;

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Configure Jest timeout for async operations
jest.setTimeout(30000);

// Mock timers setup
beforeEach(() => {
  jest.clearAllTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// Extend Jest expect with custom matchers
extendExpect(expect);
