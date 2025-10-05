// Global test setup for storage-service package

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
  // Helper to create mock Express request objects
  createMockRequest: (overrides = {}) => {
    return {
      id: 'test-request-id',
      method: 'GET',
      url: '/api/v1/test',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'test-client',
      },
      params: {},
      query: {},
      body: {},
      ...overrides,
    };
  },

  // Helper to create mock Express response objects
  createMockResponse: () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.end = jest.fn(() => res);
    res.set = jest.fn(() => res);
    res.header = jest.fn(() => res);
    return res;
  },

  // Helper to create mock Express next function
  createMockNext: () => jest.fn(),

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

  // Helper to create mock API response format
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

  // Helper to create mock search results
  createMockSearchResult: (photos = [], total = 0, overrides = {}) => {
    return {
      photos,
      total,
      page: {
        limit: 50,
        offset: 0,
        hasMore: photos.length === 50,
      },
      searchTime: 25,
      ...overrides,
    };
  },

  // Helper to create mock user photos result
  createMockUserPhotos: (photos = [], total = 0, overrides = {}) => {
    return {
      photos,
      pagination: {
        total,
        limit: 50,
        offset: 0,
        hasMore: photos.length === 50,
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

  // Helper to create test buffers
  createTestBuffer: (size = 1024, content = 'test data') => {
    return Buffer.alloc(size, content);
  },
};

// Configure test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.PORT = '3001';

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
  // Reset Date.now for consistent timestamps in tests
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2023-01-01T00:00:00.000Z').getTime());
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Mock Express application and router
jest.mock('express', () => {
  const actual = jest.requireActual('express');

  const mockRouter = () => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    use: jest.fn(),
  });

  const mockApp = () => ({
    use: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    listen: jest.fn((port, callback) => {
      if (callback) callback();
      return { close: jest.fn() };
    }),
    set: jest.fn(),
  });

  return {
    ...actual,
    Router: jest.fn(mockRouter),
    default: jest.fn(mockApp),
    json: jest.fn(() => (req, res, next) => next()),
    urlencoded: jest.fn(() => (req, res, next) => next()),
  };
});

// Mock CORS middleware
jest.mock('cors', () => {
  return jest.fn(() => (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });
});

// Global error handler for tests
global.mockErrorHandler = (err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: {
        type: 'ValidationError',
        message: err.message,
      },
    });
  }

  if (err.name === 'PhotoNotFoundError') {
    return res.status(404).json({
      success: false,
      error: {
        type: 'PhotoNotFoundError',
        message: err.message,
      },
    });
  }

  res.status(500).json({
    success: false,
    error: {
      type: 'InternalServerError',
      message: 'Internal server error',
    },
  });
};

// Extend Jest expect with custom matchers
extendExpect(expect);
