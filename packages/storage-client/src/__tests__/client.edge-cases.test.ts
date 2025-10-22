import { StorageClient } from '../client';
import { CacheManager } from '../cache';
import { Logger } from '../logger';
import axios, { AxiosInstance } from 'axios';
import { Client as MinioClient } from 'minio';
import {
  StorageError,
  ValidationError,
  PhotoNotFoundError,
  DatabaseError,
  StorageConnectionError,
} from '@shared-infra/storage-core';

// Mock dependencies
jest.mock('axios');
jest.mock('minio');
jest.mock('../cache');
jest.mock('../logger');

const MockedAxios = axios as jest.Mocked<typeof axios>;
const MockedCacheManager = CacheManager as jest.MockedClass<typeof CacheManager>;
const MockedLogger = Logger as jest.MockedClass<typeof Logger>;
const MockedMinioClient = MinioClient as jest.MockedClass<typeof MinioClient>;

describe('StorageClient Edge Cases', () => {
  let client: StorageClient;
  let mockAxios: jest.Mocked<AxiosInstance>;
  let mockCache: jest.Mocked<CacheManager>;
  let mockLogger: jest.Mocked<Logger>;
  let mockMinioClient: jest.Mocked<MinioClient>;

  const validConfig = {
    storageServiceUrl: 'http://localhost:3001',
    minioConfig: {
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup axios mock
    mockAxios = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn() },
      },
    } as any;

    MockedAxios.create.mockReturnValue(mockAxios);

    // Setup cache mock
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      deletePattern: jest.fn(),
      clear: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
      getStats: jest.fn().mockReturnValue({ size: 0, hitRate: 0 }),
      ping: jest.fn().mockResolvedValue(true),
      shutdown: jest.fn(),
    } as any;

    MockedCacheManager.mockImplementation(() => mockCache);

    // Setup logger mock
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      setLevel: jest.fn(),
    } as any;

    MockedLogger.mockImplementation(() => mockLogger);

    // Setup MinIO client mock
    mockMinioClient = {
      presignedGetObject: jest.fn(),
      presignedUrl: jest.fn(),
    } as any;

    MockedMinioClient.mockImplementation(() => mockMinioClient);

    client = new StorageClient(validConfig);
  });

  describe('constructor edge cases', () => {
    it('should handle missing optional configurations', () => {
      const minimalConfig = {
        storageServiceUrl: 'http://localhost:3001',
        minioConfig: {
          endPoint: 'localhost',
          port: 9000,
          useSSL: false,
          accessKey: 'key',
          secretKey: 'secret',
        },
      };

      expect(() => new StorageClient(minimalConfig)).not.toThrow();
    });

    it('should validate minioConfig properties', () => {
      const invalidConfigs = [
        // Missing endPoint
        {
          ...validConfig,
          minioConfig: { ...validConfig.minioConfig, endPoint: '' },
        },
        // Missing accessKey
        {
          ...validConfig,
          minioConfig: { ...validConfig.minioConfig, accessKey: '' },
        },
        // Missing secretKey
        {
          ...validConfig,
          minioConfig: { ...validConfig.minioConfig, secretKey: '' },
        },
        // Invalid port
        {
          ...validConfig,
          minioConfig: { ...validConfig.minioConfig, port: 0 },
        },
      ];

      invalidConfigs.forEach(config => {
        expect(() => new StorageClient(config)).toThrow(ValidationError);
      });
    });

    it('should handle malformed URLs', () => {
      const invalidUrlConfig = {
        ...validConfig,
        storageServiceUrl: 'not-a-url',
      };

      expect(() => new StorageClient(invalidUrlConfig)).toThrow(ValidationError);
    });

    it('should handle very large timeout values', () => {
      const largeTimeoutConfig = {
        ...validConfig,
        timeout: Number.MAX_SAFE_INTEGER,
      };

      expect(() => new StorageClient(largeTimeoutConfig)).not.toThrow();
    });
  });

  describe('storePhoto edge cases', () => {
    it('should handle empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const storeOptions = { originalName: 'empty.jpg', clientId: 'test-client' };

      await expect(client.storePhoto(emptyBuffer, storeOptions)).rejects.toThrow(ValidationError);
    });

    it('should handle very large buffers', async () => {
      const largeBuffer = Buffer.alloc(100 * 1024 * 1024, 'a'); // 100MB (exceeds 50MB limit)
      const storeOptions = {
        originalName: 'large.jpg',
        contentType: 'image/jpeg',
        clientId: 'test-client',
      };

      // Should reject large files due to validation
      await expect(client.storePhoto(largeBuffer, storeOptions)).rejects.toThrow(ValidationError);
    });

    it('should handle special characters in filenames', async () => {
      const photoData = Buffer.from('test');
      const specialFilenames = [
        'file with spaces.jpg',
        'file-with-dashes.jpg',
        'file_with_underscores.jpg',
        'file.with.dots.jpg',
        'файл.jpg', // Cyrillic
        '文件.jpg', // Chinese
        'file@#$%.jpg',
      ];

      mockAxios.post.mockResolvedValue({
        data: { success: true, data: { id: 'test-photo' } },
        status: 200,
      });

      for (const filename of specialFilenames) {
        const storeOptions = { originalName: filename, clientId: 'test-client' };
        await expect(client.storePhoto(photoData, storeOptions)).resolves.toBeDefined();
      }
    });

    it('should handle missing optional store options', async () => {
      const photoData = Buffer.from('test');
      const minimalOptions = { originalName: 'test.jpg', clientId: 'test-client' };

      mockAxios.post.mockResolvedValueOnce({
        data: { success: true, data: { id: 'minimal-photo' } },
        status: 200,
      });

      const result = await client.storePhoto(photoData, minimalOptions);
      expect(result.id).toBe('minimal-photo');
    });

    it('should handle axios network errors', async () => {
      const photoData = Buffer.from('test');
      const storeOptions = { originalName: 'test.jpg', clientId: 'test-client' };

      const networkErrors = [
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
        { code: 'ETIMEDOUT' },
        { code: 'ECONNRESET' },
      ];

      for (const error of networkErrors) {
        mockAxios.post.mockRejectedValueOnce(error);
        await expect(client.storePhoto(photoData, storeOptions)).rejects.toThrow();
        jest.clearAllMocks();
        mockAxios.post.mockClear();
      }
    });

    it('should handle malformed server responses', async () => {
      const photoData = Buffer.from('test');
      const storeOptions = { originalName: 'test.jpg', clientId: 'test-client' };

      const malformedResponses = [
        { data: null, status: 200 },
        { data: { success: false }, status: 200 },
        { data: { success: true }, status: 200 }, // Missing data
        { data: { success: true, data: null }, status: 200 },
        { data: 'not an object', status: 200 },
      ];

      for (const response of malformedResponses) {
        mockAxios.post.mockResolvedValueOnce(response);
        await expect(client.storePhoto(photoData, storeOptions)).rejects.toThrow();
        jest.clearAllMocks();
        mockAxios.post.mockClear();
      }
    });
  });

  describe('getPhoto edge cases', () => {
    it('should handle cache errors gracefully', async () => {
      const cacheErrors = [
        new Error('Cache connection lost'),
        new Error('Cache timeout'),
        new Error('Cache serialization error'),
      ];

      mockAxios.get.mockResolvedValue({
        data: { success: true, data: { id: 'photo-123' } },
        status: 200,
      });

      for (const error of cacheErrors) {
        mockCache.get.mockRejectedValueOnce(error);
        mockCache.set.mockRejectedValueOnce(error);

        const result = await client.getPhoto('photo-123');
        expect(result).toBeDefined();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Cache operation failed'),
          expect.objectContaining({ error: expect.any(String) })
        );

        jest.clearAllMocks();
      }
    });

    it('should handle malformed photo IDs', async () => {
      const malformedIds = [
        '', // empty
        ' ', // whitespace
        '\n', // newline
        '\t', // tab
        'photo with spaces',
        'photo/with/slashes',
        'photo?with&query=params',
        'очень-длинный-идентификатор-фотографии-который-может-вызвать-проблемы',
      ];

      for (const photoId of malformedIds) {
        if (photoId.trim() === '') {
          await expect(client.getPhoto(photoId)).rejects.toThrow(ValidationError);
        } else {
          mockAxios.get.mockResolvedValueOnce({
            data: { success: true, data: { id: photoId } },
            status: 200,
          });
          await expect(client.getPhoto(photoId)).resolves.toBeDefined();
        }
        jest.clearAllMocks();
      }
    });

    it('should handle various HTTP error codes', async () => {
      const errorCodes = [
        { status: 400, shouldThrow: ValidationError },
        { status: 401, shouldThrow: StorageError },
        { status: 403, shouldThrow: StorageError },
        { status: 404, shouldReturnNull: true },
        { status: 409, shouldThrow: StorageError },
        { status: 422, shouldThrow: ValidationError },
        { status: 429, shouldThrow: StorageError },
        { status: 500, shouldThrow: StorageError },
        { status: 502, shouldThrow: StorageError },
        { status: 503, shouldThrow: StorageError },
        { status: 504, shouldThrow: StorageError },
      ];

      for (const { status, shouldThrow, shouldReturnNull } of errorCodes) {
        mockCache.get.mockResolvedValueOnce(null);
        mockAxios.get.mockRejectedValueOnce({
          response: {
            status,
            data: {
              error: {
                type: shouldThrow?.name || 'Error',
                message: `Error ${status}`,
              },
            },
          },
        });

        if (shouldReturnNull) {
          const result = await client.getPhoto('photo-123');
          expect(result).toBeNull();
        } else if (shouldThrow) {
          await expect(client.getPhoto('photo-123')).rejects.toThrow(shouldThrow);
        }

        jest.clearAllMocks();
      }
    });
  });

  describe('getPhotoUrl edge cases', () => {
    it('should handle MinIO client errors', async () => {
      const mockPhoto = {
        bucket: 'images',
        s3_key: 'photos/photo-123/test.jpg',
      };

      mockAxios.get.mockResolvedValue({
        data: { success: true, data: mockPhoto },
        status: 200,
      });

      const minioErrors = [
        new Error('MinIO connection timeout'),
        new Error('Invalid bucket name'),
        new Error('Access denied'),
        new Error('Object not found'),
      ];

      for (const error of minioErrors) {
        mockMinioClient.presignedUrl.mockRejectedValueOnce(error);
        await expect(client.getPhotoUrl('photo-123')).rejects.toThrow(StorageError);
        jest.clearAllMocks();
      }
    });

    it('should handle extreme expiry values', async () => {
      const mockPhoto = {
        bucket: 'images',
        s3_key: 'photos/photo-123/test.jpg',
      };

      mockAxios.get.mockResolvedValue({
        data: { success: true, data: mockPhoto },
        status: 200,
      });

      // Test maximum allowed expiry (24 hours)
      const maxExpiry = 24 * 60 * 60; // 24 hours in seconds
      mockMinioClient.presignedUrl.mockResolvedValue('https://test-url.com');

      await expect(client.getPhotoUrl('photo-123', maxExpiry)).resolves.toBeDefined();

      // Test expiry exceeding maximum
      const excessiveExpiry = maxExpiry + 1;
      await expect(client.getPhotoUrl('photo-123', excessiveExpiry)).rejects.toThrow(
        ValidationError
      );

      // Test negative expiry
      await expect(client.getPhotoUrl('photo-123', -1)).rejects.toThrow(ValidationError);

      // Test zero expiry
      await expect(client.getPhotoUrl('photo-123', 0)).rejects.toThrow(ValidationError);
    });

    it('should handle missing photo metadata', async () => {
      const incompletePhotos = [
        { id: 'photo-123' }, // Missing bucket and s3_key
        { id: 'photo-123', bucket: 'images' }, // Missing s3_key
        { id: 'photo-123', s3_key: 'photos/photo-123/test.jpg' }, // Missing bucket
        { id: 'photo-123', bucket: '', s3_key: 'photos/photo-123/test.jpg' }, // Empty bucket
        { id: 'photo-123', bucket: 'images', s3_key: '' }, // Empty s3_key
      ];

      for (const photo of incompletePhotos) {
        mockAxios.get.mockResolvedValueOnce({
          data: { success: true, data: photo },
          status: 200,
        });

        await expect(client.getPhotoUrl('photo-123')).rejects.toThrow(StorageError);
        jest.clearAllMocks();
      }
    });
  });

  describe('updatePhotoMetadata edge cases', () => {
    it('should handle various metadata types', async () => {
      const metadataTypes = [
        { width: 1920 },
        { height: 1080 },
        { processing_status: 'completed' as any },
        { processing_metadata: 'test metadata' },
        { processing_error: 'no errors' },
        { duration: 60 },
      ];

      for (const metadata of metadataTypes) {
        mockAxios.patch.mockResolvedValueOnce({
          data: { success: true, data: { id: 'photo-123', metadata } },
          status: 200,
        });

        await expect(client.updatePhotoMetadata('photo-123', metadata)).resolves.toBeUndefined();
        jest.clearAllMocks();
      }
    });

    it('should handle cache update failures', async () => {
      mockAxios.patch.mockResolvedValue({
        data: { success: true, data: { id: 'photo-123' } },
        status: 200,
      });

      mockCache.delete.mockRejectedValueOnce(new Error('Cache deletion failed'));

      // Should still succeed even if cache update fails
      const result = await client.updatePhotoMetadata('photo-123', { width: 1920 });
      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear cache'),
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should handle very large metadata objects', async () => {
      const largeMetadata = {
        processing_metadata: 'x'.repeat(1000), // Reduced size
        processing_error: 'y'.repeat(500), // Reduced size
      };

      mockAxios.patch.mockResolvedValueOnce({
        data: { success: true, data: { id: 'photo-123' } },
        status: 200,
      });

      const result = await client.updatePhotoMetadata('photo-123', largeMetadata);
      expect(result).toBeUndefined();
      expect(mockAxios.patch).toHaveBeenCalledWith(
        '/api/v1/photos/photo-123/metadata',
        expect.objectContaining({
          metadata: expect.objectContaining({
            processing_metadata: expect.stringMatching(/^x+$/),
            processing_error: expect.stringMatching(/^y+$/),
          }),
        })
      );
    });
  });

  describe('deletePhoto edge cases', () => {
    it('should handle deletion of non-existent photos', async () => {
      mockAxios.delete.mockRejectedValueOnce({
        response: {
          status: 404,
          data: {
            error: {
              type: 'PhotoNotFoundError',
              message: 'Photo not found',
            },
          },
        },
      });

      await expect(client.deletePhoto('non-existent')).rejects.toThrow(PhotoNotFoundError);
    });

    it('should handle cache deletion failures during photo deletion', async () => {
      mockAxios.delete.mockResolvedValueOnce({
        data: { success: true },
        status: 200,
      });

      mockCache.delete.mockRejectedValueOnce(new Error('Cache deletion failed'));

      // Should still succeed
      await expect(client.deletePhoto('photo-123')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear cache'),
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should handle server errors during deletion', async () => {
      const serverErrors = [
        { status: 500, error: StorageError, errorType: 'StorageError' },
        { status: 502, error: StorageError, errorType: 'StorageError' },
        { status: 503, error: StorageError, errorType: 'StorageError' },
      ];

      for (const { status, error, errorType } of serverErrors) {
        // Mock multiple calls since some errors might be retryable
        mockAxios.delete.mockRejectedValue({
          response: {
            status,
            data: {
              error: {
                type: errorType,
                message: `Server error ${status}`,
              },
            },
          },
        });

        await expect(client.deletePhoto('photo-123')).rejects.toThrow(error);
        jest.clearAllMocks();
      }
    });
  });

  describe('healthCheck edge cases', () => {
    it('should handle partial health check failures', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            status: 'degraded',
            services: {
              database: 'connected',
              storage: 'disconnected',
              cache: 'connected',
            },
          },
        },
        status: 200,
      });

      mockCache.ping.mockResolvedValueOnce(true);

      const health = await client.healthCheck();
      expect(health.status).toBe('degraded');
      expect(health.services?.storage).toBe('disconnected');
    });

    it('should handle health check timeout', async () => {
      mockAxios.get.mockRejectedValueOnce({
        code: 'ETIMEDOUT',
        message: 'Health check timeout',
      });

      await expect(client.healthCheck()).rejects.toThrow(StorageConnectionError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Health check failed'),
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should handle malformed health response', async () => {
      const malformedResponses = [
        { data: null, status: 200 },
        { data: 'not an object', status: 200 },
        { data: { success: false }, status: 200 },
        { data: { success: true }, status: 200 }, // Missing data
        { data: { success: true, data: null }, status: 200 },
      ];

      for (const response of malformedResponses) {
        mockAxios.get.mockResolvedValueOnce(response);
        await expect(client.healthCheck()).rejects.toThrow(StorageError);
        jest.clearAllMocks();
      }
    });
  });

  describe('cache operations edge cases', () => {
    it('should handle getCacheStats when cache is disabled', async () => {
      mockCache.isEnabled.mockReturnValueOnce(false);
      const stats = await client.getCacheStats();
      expect(stats).toBeNull();
    });

    it('should handle getCacheStats errors', () => {
      mockCache.getStats.mockImplementationOnce(() => {
        throw new Error('Stats collection failed');
      });

      expect(() => client.getCacheStats()).toThrow('Stats collection failed');
    });

    it('should handle clearCache errors', async () => {
      mockCache.clear.mockRejectedValueOnce(new Error('Cache clear failed'));
      await expect(client.clearCache()).rejects.toThrow();
    });

    it('should handle clearCache when disabled', async () => {
      mockCache.isEnabled.mockReturnValueOnce(false);
      await expect(client.clearCache()).resolves.toBeUndefined();
      expect(mockCache.clear).not.toHaveBeenCalled();
    });
  });

  describe('error classification edge cases', () => {
    it('should classify various network errors correctly', async () => {
      const networkErrors = [
        { code: 'ENOTFOUND', isRetryable: true },
        { code: 'ECONNREFUSED', isRetryable: true },
        { code: 'ETIMEDOUT', isRetryable: true },
        { code: 'ECONNRESET', isRetryable: true },
        { code: 'EPIPE', isRetryable: true },
        { code: 'UNKNOWN_ERROR', isRetryable: false },
      ];

      for (const { code, isRetryable } of networkErrors) {
        const error = { code, message: `Network error: ${code}` };
        const result = (client as any).isRetryableError(error);
        expect(result).toBe(isRetryable);
      }
    });

    it('should classify HTTP errors correctly', async () => {
      const httpErrors = [
        { status: 408, isRetryable: true }, // Request timeout
        { status: 429, isRetryable: true }, // Too many requests
        { status: 502, isRetryable: true }, // Bad gateway
        { status: 503, isRetryable: true }, // Service unavailable
        { status: 504, isRetryable: true }, // Gateway timeout
        { status: 400, isRetryable: false }, // Bad request
        { status: 401, isRetryable: false }, // Unauthorized
        { status: 403, isRetryable: false }, // Forbidden
        { status: 404, isRetryable: false }, // Not found
        { status: 422, isRetryable: false }, // Unprocessable entity
        { status: 500, isRetryable: true }, // Internal server error
      ];

      for (const { status, isRetryable } of httpErrors) {
        const error = { response: { status } };
        const result = (client as any).isRetryableError(error);
        expect(result).toBe(isRetryable);
      }
    });

    it('should handle error classification for undefined errors', () => {
      const result = (client as any).isRetryableError(undefined);
      expect(result).toBe(false);
    });

    it('should handle error classification for null errors', () => {
      const result = (client as any).isRetryableError(null);
      expect(result).toBe(false);
    });
  });

  describe('retry logic edge cases', () => {
    it('should handle retry delay calculation', async () => {
      const retryConfig = {
        maxRetries: 3,
        retryDelay: 1000,
        backoffFactor: 2,
      };

      const clientWithRetry = new StorageClient({
        ...validConfig,
        retryConfig,
      });

      // Mock all requests to fail with retryable error
      mockAxios.get.mockRejectedValue({ code: 'ECONNRESET' });

      const startTime = Date.now();
      await expect(clientWithRetry.getPhoto('photo-123')).rejects.toThrow();
      const endTime = Date.now();

      // Should have taken at least some time for retries
      // (1000 + 2000 + 4000) = 7000ms minimum, but allow for some variance
      expect(endTime - startTime).toBeGreaterThan(6000);
      expect(mockAxios.get).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should handle retry with zero backoff factor', async () => {
      const retryConfig = {
        maxRetries: 2,
        retryDelay: 100,
        backoffFactor: 1, // No exponential backoff
      };

      const clientWithRetry = new StorageClient({
        ...validConfig,
        retryConfig,
      });

      mockAxios.get.mockRejectedValue({ code: 'ETIMEDOUT' });

      await expect(clientWithRetry.getPhoto('photo-123')).rejects.toThrow();
      expect(mockAxios.get).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('memory and resource management', () => {
    it('should handle rapid successive operations', async () => {
      const operationCount = 10; // Reduced from 100 to avoid large test output
      const operations = Array.from({ length: operationCount }, (_, i) => ({
        id: `photo-${i}`,
        data: Buffer.from(`test data ${i}`),
      }));

      // Mock successful responses for all operations
      mockAxios.post.mockResolvedValue({
        data: { success: true, data: { id: 'test-id' } },
        status: 200,
      });

      mockAxios.get.mockResolvedValue({
        data: { success: true, data: { id: 'test-id' } },
        status: 200,
      });

      mockCache.get.mockResolvedValue(null);

      // Execute all operations concurrently
      const storePromises = operations.map(op =>
        client.storePhoto(op.data, { originalName: `${op.id}.jpg`, clientId: 'test-client' })
      );
      const getPromises = operations.map(op => client.getPhoto(op.id));

      const results = await Promise.all([...storePromises, ...getPromises]);
      expect(results).toHaveLength(operationCount * 2);

      expect(mockAxios.post).toHaveBeenCalledTimes(operationCount);
      expect(mockAxios.get).toHaveBeenCalledTimes(operationCount);
    });

    it('should handle operations with very long strings', async () => {
      const longString = 'a'.repeat(10000); // 10KB string (reduced from 1MB)
      const metadata = {
        processing_metadata: longString,
        processing_error: 'Short error message',
      };

      mockAxios.patch.mockResolvedValueOnce({
        data: { success: true, data: { id: 'photo-123' } },
        status: 200,
      });

      const result = await client.updatePhotoMetadata('photo-123', metadata);
      expect(result).toBeUndefined();

      // Verify the call was made with the right endpoint and structure
      expect(mockAxios.patch).toHaveBeenCalledTimes(1);
      expect(mockAxios.patch).toHaveBeenCalledWith(
        '/api/v1/photos/photo-123/metadata',
        expect.objectContaining({
          metadata: expect.objectContaining({
            processing_metadata: expect.stringMatching(/^a+$/),
            processing_error: 'Short error message',
          }),
        })
      );

      // Verify the metadata size without logging it
      const callArgs = mockAxios.patch.mock.calls[0][1] as any;
      expect(callArgs.metadata.processing_metadata.length).toBe(10000);
    });
  });
});
