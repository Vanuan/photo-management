// Global test setup for storage-client package

// Import shared custom matchers
const { extendExpect } = require('../../test-utils/custom-matchers');

// TypeScript type definitions for custom matchers
/// <reference types="../../test-utils/jest-matchers" />

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
  // Helper to create test API responses
  createMockApiResponse: (data, meta = {}) => {
    return {
      success: true,
      data,
      meta: {
        requestId: 'test-request-id',
        timestamp: '2023-01-01T00:00:00.000Z',
        duration: 100,
        ...meta,
      },
    };
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

  // Helper to create mock axios responses
  createMockAxiosResponse: (data, status = 200, headers = {}) => {
    return {
      data,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      config: {
        method: 'get',
        url: 'http://localhost:3001/api/v1/test',
      },
    };
  },

  // Helper to create mock axios errors
  createMockAxiosError: (message, status = 500, response = null) => {
    const error = new Error(message);
    error.response = response || {
      status,
      statusText: 'Internal Server Error',
      data: { error: message },
    };
    error.request = {};
    error.code = status < 500 ? 'CLIENT_ERROR' : 'SERVER_ERROR';
    return error;
  },

  // Helper to wait for promises
  waitFor: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to create test dates
  createTestDate: (offset = 0) => {
    const baseDate = new Date('2023-01-01T00:00:00.000Z');
    return new Date(baseDate.getTime() + offset);
  },

  // Helper to create test buffers
  createTestBuffer: (size = 1024, content = 'test data') => {
    return Buffer.alloc(size, content);
  },

  // Helper to create truncated string for assertions
  truncateString: (str, maxLength = 100) => {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...[truncated]';
  },

  // Helper to match large strings without showing full content
  expectLargeString: (actual, expectedPattern, maxDisplayLength = 50) => {
    const truncated =
      actual.length > maxDisplayLength ? actual.substring(0, maxDisplayLength) + '...' : actual;
    return expect(actual).toMatch(expectedPattern);
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

// Mock timers setup - disabled to prevent hanging in tests
// Tests that need timer control should handle it individually
beforeEach(() => {
  jest.clearAllTimers();
  // jest.useFakeTimers(); // Commented out - causes hanging
});

afterEach(() => {
  // jest.runOnlyPendingTimers();
  // jest.useRealTimers();
});

// Extend Jest expect with custom matchers
extendExpect(expect);

// Mock axios defaults
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    create: jest.fn(() => ({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: {
          use: jest.fn(),
          eject: jest.fn(),
        },
        response: {
          use: jest.fn(),
          eject: jest.fn(),
        },
      },
    })),
  };
});

// Mock minio client
jest.mock('minio', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      presignedGetObject: jest.fn(),
      presignedUrl: jest.fn(),
      getObject: jest.fn(),
      statObject: jest.fn(),
      putObject: jest.fn(),
      removeObject: jest.fn(),
      listObjects: jest.fn(),
      bucketExists: jest.fn(),
      makeBucket: jest.fn(),
      listBuckets: jest.fn(),
    })),
  };
});
