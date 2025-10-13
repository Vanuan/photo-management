import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as Minio from 'minio';
import { StorageClient, StorageClientConfig, ApiResponse } from '../client';
import { CacheManager } from '../cache';
import { Logger } from '../logger';
import {
  StorePhotoOptions,
  PhotoResult,
  Photo,
  ValidationError,
  PhotoNotFoundError,
  StorageConnectionError,
} from '@shared-infra/storage-core';

// Mock all dependencies
jest.mock('axios');
jest.mock('minio');
jest.mock('../cache');
jest.mock('../logger');

// Create the mocked types
const MockedAxios = axios as jest.Mocked<typeof axios>;
const MockedCacheManager = CacheManager as jest.MockedClass<typeof CacheManager>;
const MockedLogger = Logger as jest.MockedClass<typeof Logger>;
const MockedMinIOClient = Minio.Client as jest.MockedClass<typeof Minio.Client>;

describe('StorageClient', () => {
  let storageClient: StorageClient;
  let mockHttpClient: jest.Mocked<AxiosInstance>;
  let mockMinioClient: jest.Mocked<Minio.Client>;
  let mockCache: jest.Mocked<CacheManager>;
  let mockLogger: jest.Mocked<Logger>;
  let config: StorageClientConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    // Mock HTTP client
    mockHttpClient = {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn(),
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
        response: { use: jest.fn(), eject: jest.fn() },
      },
    } as any;

    MockedAxios.create.mockReturnValue(mockHttpClient);

    // Mock MinIO client
    mockMinioClient = {
      presignedGetObject: jest.fn().mockResolvedValue('http://test-url'),
      presignedUrl: jest.fn().mockResolvedValue('http://test-url'),
      getObject: jest.fn(),
      statObject: jest.fn(),
      putObject: jest.fn(),
      removeObject: jest.fn(),
      bucketExists: jest.fn().mockResolvedValue(true),
      makeBucket: jest.fn(),
      listObjects: jest.fn(),
    } as any;

    MockedMinIOClient.mockImplementation(() => mockMinioClient);

    // Mock cache with default enabled state
    mockCache = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      deletePattern: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      getTTL: jest.fn().mockReturnValue(300),
      getSize: jest.fn().mockReturnValue(0),
      getMaxSize: jest.fn().mockReturnValue(1000),
      getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 }),
      getHitRate: jest.fn().mockReturnValue(0),
      shutdown: jest.fn().mockResolvedValue(undefined),
    } as any;

    MockedCacheManager.mockImplementation(() => mockCache);

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    MockedLogger.mockImplementation(() => mockLogger);

    // Setup config
    config = {
      storageServiceUrl: 'http://localhost:3001',
      minioConfig: {
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
      },
      cacheConfig: {
        enabled: true,
        ttl: 300,
        maxSize: 1000,
      },
      retryConfig: {
        maxRetries: 3,
        retryDelay: 1000,
        backoffFactor: 2,
      },
      timeout: 30000,
    };

    storageClient = new StorageClient(config);
  });

  describe('constructor', () => {
    it('should initialize with valid configuration', () => {
      expect(MockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3001',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'StorageClient/1.0.0',
        },
      });

      expect(MockedMinIOClient).toHaveBeenCalledWith({
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        region: 'us-east-1',
      });

      expect(MockedCacheManager).toHaveBeenCalledWith({
        enabled: true,
        ttl: 300,
        maxSize: 1000,
      });
    });

    it('should use default values for optional config', () => {
      const minimalConfig = {
        storageServiceUrl: 'http://localhost:3001',
        minioConfig: {
          endPoint: 'localhost',
          port: 9000,
          useSSL: false,
          accessKey: 'minioadmin',
          secretKey: 'minioadmin',
        },
      };

      new StorageClient(minimalConfig);

      expect(MockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );

      expect(MockedCacheManager).toHaveBeenCalledWith({
        enabled: true,
        ttl: 300,
        maxSize: 1000,
      });
    });

    it('should throw ValidationError for missing storageServiceUrl', () => {
      const invalidConfig = {
        ...config,
        storageServiceUrl: '',
      };

      expect(() => new StorageClient(invalidConfig)).toThrow(ValidationError);
    });

    it('should throw ValidationError for invalid minioConfig', () => {
      const invalidConfig = {
        ...config,
        minioConfig: {
          ...config.minioConfig,
          endPoint: '',
        },
      };

      expect(() => new StorageClient(invalidConfig)).toThrow(ValidationError);
    });
  });

  describe('storePhoto', () => {
    const testData = Buffer.from('test photo data');
    const storeOptions: StorePhotoOptions = {
      originalName: 'test.jpg',
      contentType: 'image/jpeg',
      clientId: 'client123',
      userId: 'user123',
    };

    it('should store photo successfully', async () => {
      const expectedResult: PhotoResult = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/presigned-url',
        bucket: 'images',
        size: testData.length,
        processing_status: 'queued',
        created_at: '2023-01-01T00:00:00.000Z',
      };

      const apiResponse: ApiResponse<PhotoResult> = {
        success: true,
        data: expectedResult,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.post.mockResolvedValue({ data: apiResponse });

      const result = await storageClient.storePhoto(testData, storeOptions);

      expect(result).toEqual(expectedResult);
      expect(mockHttpClient.post).toHaveBeenCalledWith('/api/v1/photos', {
        data: testData.toString('base64'),
        options: storeOptions,
      });
    });

    it('should validate photo data', async () => {
      const emptyData = Buffer.from('');

      await expect(storageClient.storePhoto(emptyData, storeOptions)).rejects.toThrow(
        ValidationError
      );
    });

    it('should validate store options', async () => {
      const invalidOptions = { ...storeOptions, originalName: '' };

      await expect(storageClient.storePhoto(testData, invalidOptions)).rejects.toThrow(
        ValidationError
      );
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('Network error');
      mockHttpClient.post.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.storePhoto(testData, storeOptions)).rejects.toThrow(
        'Failed to store photo'
      );

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });

    it('should retry on retryable errors', async () => {
      const error = { response: { status: 500 } };
      mockHttpClient.post
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { id: 'photo123' } as PhotoResult,
            meta: { requestId: 'req-123', timestamp: '2023-01-01T00:00:00.000Z' },
          },
        });

      // Override the sleep function to avoid real delays
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      const result = await storageClient.storePhoto(testData, storeOptions);

      expect(mockHttpClient.post).toHaveBeenCalledTimes(3);
      expect(result.id).toBe('photo123');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('getPhoto', () => {
    const photoId = 'photo123';
    const mockPhoto: Photo = {
      id: photoId,
      s3_key: 'photos/photo123/test.jpg',
      s3_url: 'https://minio.test/presigned-url',
      bucket: 'images',
      size: 1024,
      processing_status: 'completed',
      created_at: '2023-01-01T00:00:00.000Z',
      original_filename: 'test.jpg',
      mime_type: 'image/jpeg',
      client_id: 'client123',
      uploaded_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
    };

    it('should get photo from cache if available', async () => {
      mockCache.isEnabled.mockReturnValue(true);
      mockCache.get.mockResolvedValue(mockPhoto);

      const result = await storageClient.getPhoto(photoId);

      expect(result).toEqual(mockPhoto);
      expect(mockCache.get).toHaveBeenCalledWith(`photo:${photoId}`);
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });

    it('should get photo from service if not in cache', async () => {
      mockCache.isEnabled.mockReturnValue(true);
      mockCache.get.mockResolvedValue(null);
      mockCache.getTTL.mockReturnValue(300);

      const apiResponse: ApiResponse<Photo> = {
        success: true,
        data: mockPhoto,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.get.mockResolvedValue({ data: apiResponse });

      const result = await storageClient.getPhoto(photoId);

      expect(result).toEqual(mockPhoto);
      expect(mockHttpClient.get).toHaveBeenCalledWith(`/api/v1/photos/${photoId}`);
      expect(mockCache.set).toHaveBeenCalledWith(`photo:${photoId}`, mockPhoto, 300);
    });

    it('should skip cache if disabled', async () => {
      mockCache.isEnabled.mockReturnValue(false);

      const apiResponse: ApiResponse<Photo> = {
        success: true,
        data: mockPhoto,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.get.mockResolvedValue({ data: apiResponse });

      const result = await storageClient.getPhoto(photoId);

      expect(result).toEqual(mockPhoto);
      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('should return null for 404 errors', async () => {
      mockCache.isEnabled.mockReturnValue(false);
      const error = { response: { status: 404 } };
      mockHttpClient.get.mockRejectedValue(error);

      const result = await storageClient.getPhoto(photoId);

      expect(result).toBeNull();
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(storageClient.getPhoto('')).rejects.toThrow(ValidationError);
      await expect(storageClient.getPhoto('')).rejects.toThrow('Photo ID is required');
    });

    it('should handle other HTTP errors', async () => {
      mockCache.isEnabled.mockReturnValue(false);
      const error = { response: { status: 500 } };
      mockHttpClient.get.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.getPhoto(photoId)).rejects.toThrow('Failed to get photo');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('getPhotoUrl', () => {
    const photoId = 'photo123';

    it('should get photo URL with default expiry', async () => {
      const photoId = 'photo123';
      const expectedUrl = 'https://minio.test/presigned-url';
      const mockPhoto = {
        id: photoId,
        bucket: 'photos',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/photos/photo123/test.jpg',
        size: 1024,
        processing_status: 'completed' as const,
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockCache.isEnabled.mockReturnValue(false);
      mockHttpClient.get.mockResolvedValue({ data: { success: true, data: mockPhoto } });

      // Use the mockMinioClient directly
      mockMinioClient.presignedUrl = jest.fn().mockResolvedValue(expectedUrl);

      const result = await storageClient.getPhotoUrl(photoId);

      expect(result).toBe(expectedUrl);
      expect(mockMinioClient.presignedUrl).toHaveBeenCalledWith(
        'GET',
        'photos',
        'photos/photo123/test.jpg',
        3600
      );
    });

    it('should get photo URL with custom expiry', async () => {
      const photoId = 'photo123';
      const expectedUrl = 'https://minio.test/presigned-url';
      const expiry = 7200;
      const mockPhoto = {
        id: photoId,
        bucket: 'photos',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/photos/photo123/test.jpg',
        size: 1024,
        processing_status: 'completed' as const,
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockCache.isEnabled.mockReturnValue(false);
      mockHttpClient.get.mockResolvedValue({ data: { success: true, data: mockPhoto } });

      // Use the mockMinioClient directly
      mockMinioClient.presignedUrl = jest.fn().mockResolvedValue(expectedUrl);

      const result = await storageClient.getPhotoUrl(photoId, expiry);

      expect(result).toBe(expectedUrl);
      expect(mockMinioClient.presignedUrl).toHaveBeenCalledWith(
        'GET',
        'photos',
        'photos/photo123/test.jpg',
        expiry
      );
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(storageClient.getPhotoUrl('')).rejects.toThrow(ValidationError);
      await expect(storageClient.getPhotoUrl('')).rejects.toThrow('Photo ID is required');
    });

    it('should throw ValidationError for excessive expiry', async () => {
      await expect(storageClient.getPhotoUrl(photoId, 100000)).rejects.toThrow(ValidationError);
      await expect(storageClient.getPhotoUrl(photoId, 100000)).rejects.toThrow(
        'Expiry cannot exceed 86400 seconds'
      );
    });

    it('should handle HTTP errors', async () => {
      const error = new Error('MinIO connection failed');
      mockCache.isEnabled.mockReturnValue(false);
      mockHttpClient.get.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.getPhotoUrl(photoId)).rejects.toThrow('Failed to get photo URL');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('updatePhotoMetadata', () => {
    const photoId = 'photo123';
    const metadata = {
      width: 1920,
      height: 1080,
      processing_status: 'completed' as const,
    };

    it('should update photo metadata successfully', async () => {
      const apiResponse: ApiResponse<void> = {
        success: true,
        data: undefined,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.patch.mockResolvedValue({ data: apiResponse });
      mockCache.isEnabled.mockReturnValue(true);

      await storageClient.updatePhotoMetadata(photoId, metadata);

      expect(mockHttpClient.patch).toHaveBeenCalledWith(`/api/v1/photos/${photoId}/metadata`, {
        metadata,
      });
      expect(mockCache.delete).toHaveBeenCalledWith(`photo:${photoId}`);
    });

    it('should not clear cache if disabled', async () => {
      const apiResponse: ApiResponse<void> = {
        success: true,
        data: undefined,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.patch.mockResolvedValue({ data: apiResponse });
      mockCache.isEnabled.mockReturnValue(false);

      await storageClient.updatePhotoMetadata(photoId, metadata);

      expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(storageClient.updatePhotoMetadata('', metadata)).rejects.toThrow(
        ValidationError
      );
    });

    it('should throw ValidationError for empty metadata', async () => {
      await expect(storageClient.updatePhotoMetadata(photoId, {})).rejects.toThrow(ValidationError);
    });

    it('should handle HTTP errors', async () => {
      const error = { response: { status: 500 } };
      mockHttpClient.patch.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.updatePhotoMetadata(photoId, metadata)).rejects.toThrow(
        'Failed to update photo metadata'
      );

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('deletePhoto', () => {
    const photoId = 'photo123';

    it('should delete photo successfully', async () => {
      const apiResponse: ApiResponse<void> = {
        success: true,
        data: undefined,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.delete.mockResolvedValue({ data: apiResponse });
      mockCache.isEnabled.mockReturnValue(true);

      await storageClient.deletePhoto(photoId);

      expect(mockHttpClient.delete).toHaveBeenCalledWith(`/api/v1/photos/${photoId}`);
      expect(mockCache.delete).toHaveBeenCalledWith(`photo:${photoId}`);
    });

    it('should not clear cache if disabled', async () => {
      const apiResponse: ApiResponse<void> = {
        success: true,
        data: undefined,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.delete.mockResolvedValue({ data: apiResponse });
      mockCache.isEnabled.mockReturnValue(false);

      await storageClient.deletePhoto(photoId);

      expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(storageClient.deletePhoto('')).rejects.toThrow(ValidationError);
      await expect(storageClient.deletePhoto('')).rejects.toThrow('Photo ID is required');
    });

    it('should handle HTTP errors', async () => {
      const error = { response: { status: 500 } };
      mockHttpClient.delete.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.deletePhoto(photoId)).rejects.toThrow('Failed to delete photo');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const healthStatus = {
        service: 'healthy' as const,
        database: 'connected' as const,
        storage: 'connected' as const,
        timestamp: '2023-01-01T00:00:00.000Z',
        uptime: 3600,
        version: '1.0.0',
      };

      const apiResponse: ApiResponse<typeof healthStatus> = {
        success: true,
        data: healthStatus,
        meta: {
          requestId: 'req-123',
          timestamp: '2023-01-01T00:00:00.000Z',
        },
      };

      mockHttpClient.get.mockResolvedValue({ data: apiResponse });

      const result = await storageClient.healthCheck();

      expect(result).toEqual(healthStatus);
      expect(mockHttpClient.get).toHaveBeenCalledWith('/api/v1/health', { timeout: 5000 });
    });

    it('should handle health check errors', async () => {
      const error = { response: { status: 503 } };
      mockHttpClient.get.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.healthCheck()).rejects.toThrow('Health check failed');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });

  describe('cache operations', () => {
    it('should clear cache successfully', async () => {
      mockCache.isEnabled.mockReturnValue(true);

      await storageClient.clearCache();

      expect(mockCache.clear).toHaveBeenCalled();
    });

    it('should not clear cache if disabled', async () => {
      mockCache.isEnabled.mockReturnValue(false);

      await storageClient.clearCache();

      expect(mockCache.clear).not.toHaveBeenCalled();
    });

    it('should return cache stats', () => {
      const stats = {
        size: 10,
        maxSize: 1000,
        hitCount: 85,
        missCount: 15,
        hitRate: 0.85,
        enabled: true,
      };

      mockCache.isEnabled.mockReturnValue(true);
      mockCache.getStats.mockReturnValue(stats);

      const result = storageClient.getCacheStats();

      expect(result).toEqual(stats);
    });

    it('should return null cache stats if disabled', () => {
      mockCache.isEnabled.mockReturnValue(false);

      const result = storageClient.getCacheStats();

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should identify not found errors', async () => {
      mockCache.isEnabled.mockReturnValue(false);
      const error = { response: { status: 404 } };
      mockHttpClient.get.mockRejectedValue(error);

      const result = await storageClient.getPhoto('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      const error = new Error('Network Error');
      mockHttpClient.post.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(
        storageClient.storePhoto(Buffer.from('test'), {
          originalName: 'test.jpg',
          clientId: 'client123',
        })
      ).rejects.toThrow('Failed to store photo');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });

    it('should handle timeout errors', async () => {
      const error = { code: 'ECONNABORTED' };
      mockHttpClient.get.mockRejectedValue(error);

      // Override the sleep function to avoid real delays in retry logic
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.getPhoto('photo123')).rejects.toThrow('Failed to get photo');

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });

    it('should handle validation errors', async () => {
      const error = {
        response: {
          status: 400,
          data: {
            error: {
              type: 'ValidationError',
              message: 'Validation failed',
            },
          },
        },
      };
      mockHttpClient.post.mockRejectedValue(error);

      await expect(
        storageClient.storePhoto(Buffer.from('test'), {
          originalName: 'test.jpg',
          clientId: 'client123',
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('retry logic', () => {
    it('should retry on retryable errors', async () => {
      const error = { response: { status: 503 } };
      mockHttpClient.get
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { id: 'photo123' } as Photo,
            meta: { requestId: 'req-123', timestamp: '2023-01-01T00:00:00.000Z' },
          },
        });

      mockCache.isEnabled.mockReturnValue(false);

      // Override the sleep function to avoid real delays
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await storageClient.getPhoto('photo123');

      expect(mockHttpClient.get).toHaveBeenCalledTimes(3);

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });

    it('should not retry on non-retryable errors', async () => {
      const error = { response: { status: 400 } };
      mockHttpClient.get.mockRejectedValue(error);
      mockCache.isEnabled.mockReturnValue(false);

      await expect(storageClient.getPhoto('photo123')).rejects.toThrow();

      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });

    it('should respect max retry limit', async () => {
      const error = { response: { status: 503 } };
      mockHttpClient.get.mockRejectedValue(error);
      mockCache.isEnabled.mockReturnValue(false);

      // Override the sleep function to avoid real delays
      const originalSleep = (storageClient as any).sleep;
      (storageClient as any).sleep = jest.fn().mockResolvedValue(undefined);

      await expect(storageClient.getPhoto('photo123')).rejects.toThrow();

      expect(mockHttpClient.get).toHaveBeenCalledTimes(4); // initial + 3 retries

      // Restore original sleep function
      (storageClient as any).sleep = originalSleep;
    });
  });
});
