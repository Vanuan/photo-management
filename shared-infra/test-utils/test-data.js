// Test data constants to avoid long strings in test files
// This module provides reusable test data that won't clutter test output

/**
 * Base64 encoded test data constants
 */
const TEST_DATA_BASE64 = {
  // Simple text data
  SIMPLE_TEXT: 'dGVzdA==', // 'test' in base64
  PHOTO_DATA: 'dGVzdCBwaG90byBkYXRh', // 'test photo data' in base64
  CONCURRENT: 'dGVzdC1jb25jdXJyZW50', // 'test-concurrent' in base64

  // Small 1x1 PNG image (67 bytes) - valid PNG format for testing
  SMALL_PNG: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',

  // Small JPEG image data (minimal valid JPEG)
  SMALL_JPEG: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/wA==',

  // Binary data patterns for testing
  BINARY_PATTERN: Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD]).toString('base64'),

  // Large-ish data for size testing (1KB of 'A')
  LARGE_TEXT: Buffer.from('A'.repeat(1024)).toString('base64'),
};

/**
 * Buffer constants for direct use in tests
 */
const TEST_BUFFERS = {
  EMPTY: Buffer.alloc(0),
  SMALL: Buffer.from('test data'),
  PHOTO_DATA: Buffer.from(TEST_DATA_BASE64.PHOTO_DATA, 'base64'),
  PNG_IMAGE: Buffer.from(TEST_DATA_BASE64.SMALL_PNG, 'base64'),
  JPEG_IMAGE: Buffer.from(TEST_DATA_BASE64.SMALL_JPEG, 'base64'),
  BINARY_PATTERN: Buffer.from(TEST_DATA_BASE64.BINARY_PATTERN, 'base64'),
};

/**
 * Mock photo objects for testing
 */
const MOCK_PHOTOS = {
  BASIC: {
    id: 'photo-123',
    s3_key: 'photos/photo-123/test.jpg',
    s3_url: 'https://localhost:9000/photos/photo-123/test.jpg',
    bucket: 'images',
    size: 1024,
    processing_status: 'completed',
    created_at: '2023-01-01T00:00:00.000Z',
    original_filename: 'test.jpg',
    mime_type: 'image/jpeg',
    client_id: 'test-client',
    uploaded_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
  },

  PNG: {
    id: 'photo-456',
    s3_key: 'photos/photo-456/test.png',
    s3_url: 'https://localhost:9000/photos/photo-456/test.png',
    bucket: 'images',
    size: 67,
    processing_status: 'completed',
    created_at: '2023-01-01T00:00:00.000Z',
    original_filename: 'test.png',
    mime_type: 'image/png',
    client_id: 'test-client',
    uploaded_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
  },

  LARGE: {
    id: 'photo-789',
    s3_key: 'photos/photo-789/large.jpg',
    s3_url: 'https://localhost:9000/photos/photo-789/large.jpg',
    bucket: 'images-large',
    size: 1048576, // 1MB
    processing_status: 'completed',
    created_at: '2023-01-01T00:00:00.000Z',
    original_filename: 'large.jpg',
    mime_type: 'image/jpeg',
    client_id: 'test-client',
    uploaded_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
  },
};

/**
 * Mock store options for testing
 */
const MOCK_STORE_OPTIONS = {
  BASIC: {
    originalName: 'test.jpg',
    contentType: 'image/jpeg',
    clientId: 'test-client',
    userId: 'test-user',
    sessionId: 'test-session',
    metadata: {
      source: 'test',
    },
  },

  PNG: {
    originalName: 'test.png',
    contentType: 'image/png',
    clientId: 'test-client',
    userId: 'test-user',
    sessionId: 'test-session',
    metadata: {
      source: 'test',
      format: 'png',
    },
  },

  MINIMAL: {
    originalName: 'test.jpg',
    clientId: 'test-client',
  },

  WITH_METADATA: {
    originalName: 'test.jpg',
    contentType: 'image/jpeg',
    clientId: 'test-client',
    userId: 'test-user',
    sessionId: 'test-session',
    metadata: {
      source: 'integration-test',
      workflow: 'complete-lifecycle',
      tags: ['test', 'integration'],
      location: 'test-suite',
    },
  },
};

/**
 * Mock API responses for testing
 */
const MOCK_API_RESPONSES = {
  SUCCESS: {
    success: true,
    data: MOCK_PHOTOS.BASIC,
    meta: {
      requestId: 'test-request-id',
      timestamp: '2023-01-01T00:00:00.000Z',
      duration: 100,
    },
  },

  ERROR_VALIDATION: {
    success: false,
    error: {
      type: 'ValidationError',
      message: 'Invalid request data',
    },
  },

  ERROR_NOT_FOUND: {
    success: false,
    error: {
      type: 'PhotoNotFoundError',
      message: 'Photo not found',
    },
  },

  ERROR_INTERNAL: {
    success: false,
    error: {
      type: 'InternalServerError',
      message: 'Internal server error',
    },
  },
};

/**
 * Long strings that should be truncated in test output
 */
const LONG_STRINGS = {
  // Complex URL with many parameters (keep for URL validation tests)
  COMPLEX_URL: 'https://example.com/search?q=test&limit=10&offset=20&sort=date&order=desc&include=metadata,tags&exclude=internal&format=json',

  // URL with encoded characters
  ENCODED_URL: 'https://example.com/search?q=hello%20world&data=%7B%22key%22%3A%22value%22%7D',

  // Long log message pattern
  LOG_PATTERN_BASIC: /\[.*\] ERROR \[TestLogger\]: test error with metadata \{"userId":"123","action":"upload"\}/,

  // Complex metadata log pattern
  LOG_PATTERN_COMPLEX: /\[.*\] INFO \[TestLogger\]: complex metadata \{"string":"value","number":42,"boolean":true,"nested":\{"key":"nestedValue"\},"array":\[1,2,3\]\}/,
};

/**
 * Helper functions to create test data
 */
const TEST_HELPERS = {
  /**
   * Create a buffer of specified size filled with pattern
   */
  createBuffer: (size, pattern = 'test') => {
    const fullPattern = pattern.repeat(Math.ceil(size / pattern.length));
    return Buffer.from(fullPattern.slice(0, size));
  },

  /**
   * Create base64 string from text
   */
  toBase64: (text) => Buffer.from(text).toString('base64'),

  /**
   * Create mock photo with overrides
   */
  createPhoto: (overrides = {}) => ({
    ...MOCK_PHOTOS.BASIC,
    ...overrides,
  }),

  /**
   * Create mock store options with overrides
   */
  createStoreOptions: (overrides = {}) => ({
    ...MOCK_STORE_OPTIONS.BASIC,
    ...overrides,
  }),

  /**
   * Create mock API response
   */
  createApiResponse: (data, meta = {}) => ({
    success: true,
    data,
    meta: {
      requestId: 'test-request-id',
      timestamp: '2023-01-01T00:00:00.000Z',
      duration: 100,
      ...meta,
    },
  }),
};

module.exports = {
  TEST_DATA_BASE64,
  TEST_BUFFERS,
  MOCK_PHOTOS,
  MOCK_STORE_OPTIONS,
  MOCK_API_RESPONSES,
  LONG_STRINGS,
  TEST_HELPERS,
};
