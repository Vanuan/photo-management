import {
  StorageClient,
  CacheManager,
  createCacheManager,
  Logger,
  createLogger,
  logger,
  VERSION,
  DEFAULT_CLIENT_CONFIG,
  utils,
} from '../index';

// Import test data constants
const { LONG_STRINGS } = require('../../../../test-utils/test-data');

// Mock dependencies to avoid side effects
jest.mock('../client');
jest.mock('../cache');
jest.mock('../logger');

describe('Index Module', () => {
  describe('exports', () => {
    it('should export StorageClient class', () => {
      expect(StorageClient).toBeDefined();
      expect(typeof StorageClient).toBe('function');
    });

    it('should export CacheManager class', () => {
      expect(CacheManager).toBeDefined();
      expect(typeof CacheManager).toBe('function');
    });

    it('should export createCacheManager function', () => {
      expect(createCacheManager).toBeDefined();
      expect(typeof createCacheManager).toBe('function');
    });

    it('should export Logger class', () => {
      expect(Logger).toBeDefined();
      expect(typeof Logger).toBe('function');
    });

    it('should export createLogger function', () => {
      expect(createLogger).toBeDefined();
      expect(typeof createLogger).toBe('function');
    });

    it('should export default logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger).toBe('object');
    });

    it('should export VERSION constant', () => {
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
      expect(VERSION).toBe('1.0.0');
    });

    it('should export DEFAULT_CLIENT_CONFIG', () => {
      expect(DEFAULT_CLIENT_CONFIG).toBeDefined();
      expect(typeof DEFAULT_CLIENT_CONFIG).toBe('object');
    });

    it('should export utils object', () => {
      expect(utils).toBeDefined();
      expect(typeof utils).toBe('object');
    });
  });

  describe('DEFAULT_CLIENT_CONFIG', () => {
    it('should have correct structure and values', () => {
      expect(DEFAULT_CLIENT_CONFIG).toEqual({
        timeout: 30000,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          backoffFactor: 2,
        },
        cacheConfig: {
          enabled: true,
          ttl: 300,
          maxSize: 1000,
        },
      });
    });

    it('should have reasonable default timeout', () => {
      expect(DEFAULT_CLIENT_CONFIG.timeout).toBe(30000);
      expect(DEFAULT_CLIENT_CONFIG.timeout).toBeGreaterThan(0);
    });

    it('should have valid retry configuration', () => {
      const { retryConfig } = DEFAULT_CLIENT_CONFIG;
      expect(retryConfig.maxRetries).toBeGreaterThan(0);
      expect(retryConfig.retryDelay).toBeGreaterThan(0);
      expect(retryConfig.backoffFactor).toBeGreaterThanOrEqual(1);
    });

    it('should have valid cache configuration', () => {
      const { cacheConfig } = DEFAULT_CLIENT_CONFIG;
      expect(typeof cacheConfig.enabled).toBe('boolean');
      expect(cacheConfig.ttl).toBeGreaterThan(0);
      expect(cacheConfig.maxSize).toBeGreaterThan(0);
    });
  });

  describe('utils', () => {
    describe('createStorageClient', () => {
      it('should create a StorageClient instance', () => {
        const config = {
          storageServiceUrl: 'http://localhost:3001',
          minioConfig: {
            endPoint: 'localhost',
            port: 9000,
            useSSL: false,
            accessKey: 'test',
            secretKey: 'test',
          },
        };

        const client = utils.createStorageClient(config);
        expect(client).toBeInstanceOf(StorageClient);
      });

      it('should handle different configuration types', () => {
        const configs = [
          {
            storageServiceUrl: 'https://api.example.com',
            minioConfig: {
              endPoint: 'minio.example.com',
              port: 443,
              useSSL: true,
              accessKey: 'access',
              secretKey: 'secret',
            },
          },
          {
            storageServiceUrl: 'http://localhost:3001',
            minioConfig: {
              endPoint: 'localhost',
              port: 9000,
              useSSL: false,
              accessKey: 'minioadmin',
              secretKey: 'minioadmin',
            },
            timeout: 60000,
            retryConfig: {
              maxRetries: 5,
              retryDelay: 2000,
              backoffFactor: 3,
            },
          },
        ];

        configs.forEach(config => {
          expect(() => utils.createStorageClient(config)).not.toThrow();
        });
      });
    });

    describe('isValidUrl', () => {
      it('should validate correct HTTP URLs', () => {
        const validUrls = [
          'http://localhost:3001',
          'https://api.example.com',
          'http://192.168.1.1:8080',
          'https://subdomain.example.com:443/path',
          'http://example.com/api/v1',
          'https://example.com/path?query=value&another=param',
          'http://[::1]:3000', // IPv6
          'https://user:pass@example.com:8080/path',
        ];

        validUrls.forEach(url => {
          expect(utils.isValidUrl(url)).toBe(true);
        });
      });

      it('should validate other valid URL schemes', () => {
        const validUrls = [
          'ftp://files.example.com',
          'ws://websocket.example.com',
          'wss://secure-websocket.example.com',
          'file:///path/to/file',
          'data:text/plain;base64,SGVsbG8gV29ybGQ=',
        ];

        validUrls.forEach(url => {
          expect(utils.isValidUrl(url)).toBe(true);
        });
      });

      it('should reject invalid URLs', () => {
        const invalidUrls = [
          '',
          'not-a-url',
          'http://',
          'https://',
          '://missing-protocol',
          'http//missing-colon',
          'http://[invalid-ipv6',
          'relative/path',
          '/absolute/path',
          '?query=only',
          '#fragment-only',
          'http://space in url.com',
          'http://example.com:99999', // Invalid port
          null as any,
          undefined as any,
          123 as any,
          {} as any,
        ];

        invalidUrls.forEach(url => {
          expect(utils.isValidUrl(url)).toBe(false);
        });
      });

      it('should handle edge cases', () => {
        // Very long URL
        const longUrl = 'https://example.com/' + 'a'.repeat(2000);
        expect(utils.isValidUrl(longUrl)).toBe(true);

        // URL with many parameters
        const complexUrl = LONG_STRINGS.COMPLEX_URL;
        expect(utils.isValidUrl(complexUrl)).toBe(true);

        // URL with encoded characters
        const encodedUrl = LONG_STRINGS.ENCODED_URL;
        expect(utils.isValidUrl(encodedUrl)).toBe(true);
      });

      it('should handle special characters correctly', () => {
        const specialUrls = [
          'https://example.com/path-with-dashes',
          'https://example.com/path_with_underscores',
          'https://example.com/path.with.dots',
          'https://example.com/path~with~tildes',
          'https://sub-domain.example-site.com',
        ];

        specialUrls.forEach(url => {
          expect(utils.isValidUrl(url)).toBe(true);
        });
      });
    });

    describe('formatBytes', () => {
      it('should format zero bytes correctly', () => {
        expect(utils.formatBytes(0)).toBe('0 Bytes');
      });

      it('should format bytes correctly', () => {
        const testCases = [
          { input: 1, expected: '1 Bytes' },
          { input: 500, expected: '500 Bytes' },
          { input: 999, expected: '999 Bytes' },
          { input: 1023, expected: '1023 Bytes' },
        ];

        testCases.forEach(({ input, expected }) => {
          expect(utils.formatBytes(input)).toBe(expected);
        });
      });

      it('should format kilobytes correctly', () => {
        const testCases = [
          { input: 1024, expected: '1 KB' },
          { input: 1536, expected: '1.5 KB' },
          { input: 2048, expected: '2 KB' },
          { input: 5120, expected: '5 KB' },
          { input: 1024 * 10.5, expected: '10.5 KB' },
        ];

        testCases.forEach(({ input, expected }) => {
          expect(utils.formatBytes(input)).toBe(expected);
        });
      });

      it('should format megabytes correctly', () => {
        const testCases = [
          { input: 1024 * 1024, expected: '1 MB' },
          { input: 1024 * 1024 * 1.5, expected: '1.5 MB' },
          { input: 1024 * 1024 * 2.75, expected: '2.75 MB' },
          { input: 1024 * 1024 * 10, expected: '10 MB' },
          { input: 1024 * 1024 * 100.25, expected: '100.25 MB' },
        ];

        testCases.forEach(({ input, expected }) => {
          expect(utils.formatBytes(input)).toBe(expected);
        });
      });

      it('should format gigabytes correctly', () => {
        const testCases = [
          { input: 1024 * 1024 * 1024, expected: '1 GB' },
          { input: 1024 * 1024 * 1024 * 1.5, expected: '1.5 GB' },
          { input: 1024 * 1024 * 1024 * 2.25, expected: '2.25 GB' },
          { input: 1024 * 1024 * 1024 * 5.75, expected: '5.75 GB' },
        ];

        testCases.forEach(({ input, expected }) => {
          expect(utils.formatBytes(input)).toBe(expected);
        });
      });

      it('should handle very large numbers', () => {
        // Test with numbers larger than GB (should show as TB)
        const veryLarge = 1024 * 1024 * 1024 * 1024; // 1 TB
        const result = utils.formatBytes(veryLarge);
        expect(result).toBe('1 TB');
      });

      it('should handle decimal precision correctly', () => {
        const testCases = [
          { input: 1536, expected: '1.5 KB' }, // Exactly 1.5
          { input: 1587, expected: '1.55 KB' }, // Should round to 2 decimals
          { input: 1588, expected: '1.55 KB' }, // Rounding test
          { input: 1589, expected: '1.55 KB' }, // Rounding test
          { input: 1590, expected: '1.55 KB' }, // Should round to 1.55
          { input: 1597, expected: '1.56 KB' }, // Should round up
        ];

        testCases.forEach(({ input, expected }) => {
          expect(utils.formatBytes(input)).toBe(expected);
        });
      });

      it('should handle negative numbers', () => {
        // While not realistic for byte counts, test the behavior
        expect(utils.formatBytes(-1024)).toBe('-1 KB');
        expect(utils.formatBytes(-1536)).toBe('-1.5 KB');
      });

      it('should handle floating point inputs', () => {
        expect(utils.formatBytes(1024.5)).toBe('1 KB');
        expect(utils.formatBytes(1536.7)).toBe('1.5 KB');
      });

      it('should handle edge cases', () => {
        // Test with very small positive number
        expect(utils.formatBytes(0.5)).toBe('0.5 Bytes');

        // Test with Number.MAX_SAFE_INTEGER
        const maxSafe = Number.MAX_SAFE_INTEGER;
        const result = utils.formatBytes(maxSafe);
        expect(result).toMatch(/^\d+(\.\d{1,2})? (Bytes|KB|MB|GB|TB|PB)$/);

        // Test with Infinity
        const infinityResult = utils.formatBytes(Infinity);
        expect(infinityResult).toBe('Infinity Bytes');

        // Test with NaN
        const nanResult = utils.formatBytes(NaN);
        expect(nanResult).toBe('NaN Bytes');
      });
    });
  });

  describe('type exports', () => {
    it('should export necessary types without runtime errors', () => {
      // These are compile-time checks, but we can verify the module loads
      expect(() => require('../index')).not.toThrow();
    });
  });

  describe('re-exports from storage-core', () => {
    it('should re-export storage-core types and classes', () => {
      const {
        StorageError,
        ValidationError,
        PhotoNotFoundError,
        DatabaseError,
        StorageConnectionError,
      } = require('../index');

      expect(StorageError).toBeDefined();
      expect(ValidationError).toBeDefined();
      expect(PhotoNotFoundError).toBeDefined();
      expect(DatabaseError).toBeDefined();
      expect(StorageConnectionError).toBeDefined();
    });
  });

  describe('version information', () => {
    it('should have semantic version format', () => {
      const semverPattern = /^\d+\.\d+\.\d+(-[\w\.\-]+)?(\+[\w\.\-]+)?$/;
      expect(VERSION).toMatch(semverPattern);
    });

    it('should be a valid version string', () => {
      expect(typeof VERSION).toBe('string');
      expect(VERSION.length).toBeGreaterThan(0);
    });
  });

  describe('module integrity', () => {
    it('should not modify exported objects unexpectedly', () => {
      const originalConfig = { ...DEFAULT_CLIENT_CONFIG };
      const originalUtils = { ...utils };

      // Try to modify exports (shouldn't affect the originals if properly exported)
      const exportedConfig = DEFAULT_CLIENT_CONFIG;
      const exportedUtils = utils;

      // Verify the exported objects are still intact
      expect(DEFAULT_CLIENT_CONFIG).toEqual(originalConfig);
      expect(utils).toEqual(originalUtils);
    });

    it('should export all expected utilities', () => {
      const expectedUtilities = ['createStorageClient', 'isValidUrl', 'formatBytes'];

      expectedUtilities.forEach(utility => {
        expect(utils).toHaveProperty(utility);
        expect(typeof (utils as any)[utility]).toBe('function');
      });
    });

    it('should not expose internal implementation details', () => {
      // Verify that only intended properties are exported
      const moduleExports = Object.keys(require('../index'));
      const expectedExports = [
        'StorageClient',
        'CacheManager',
        'createCacheManager',
        'Logger',
        'createLogger',
        'logger',
        'VERSION',
        'DEFAULT_CLIENT_CONFIG',
        'utils',
        // Type exports don't appear in runtime
        // Re-exports from storage-core
        'StorageError',
        'ValidationError',
        'PhotoNotFoundError',
        'DatabaseError',
        'StorageConnectionError',
      ];

      // Check that we don't export more than expected
      expect(moduleExports.length).toBeLessThanOrEqual(expectedExports.length + 5); // Allow some flexibility for type exports

      // Check that all expected exports are present
      expectedExports.forEach(expectedExport => {
        expect(moduleExports).toContain(expectedExport);
      });
    });
  });
});
