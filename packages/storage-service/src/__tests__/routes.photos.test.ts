import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { PhotoRoutes } from '../routes/photos';
import {
  StorageCoordinator,
  Logger,
  ValidationError,
  PhotoNotFoundError,
} from '@shared-infra/storage-core';

// Import test data constants
const { TEST_DATA_BASE64 } = require('../../../../test-utils/test-data');

// Import type extensions
import '../server';

// Unmock Express for unit tests to work properly
jest.unmock('express');

// Mock dependencies
jest.mock('@shared-infra/storage-core', () => {
  const actual = jest.requireActual('@shared-infra/storage-core');
  return {
    ...actual,
    StorageCoordinator: jest.fn(),
    Logger: jest.fn(),
    // Keep real error classes so messages work properly
    ValidationError: actual.ValidationError,
    PhotoNotFoundError: actual.PhotoNotFoundError,
  };
});

const MockedStorageCoordinator = StorageCoordinator as jest.MockedClass<typeof StorageCoordinator>;
const MockedLogger = Logger as jest.MockedClass<typeof Logger>;

describe('PhotoRoutes', () => {
  let app: express.Application;
  let mockStorage: jest.Mocked<StorageCoordinator>;
  let mockLogger: jest.Mocked<Logger>;
  let photoRoutes: PhotoRoutes;

  beforeEach(() => {
    // Mock storage coordinator
    mockStorage = {
      storePhoto: jest.fn(),
      getPhoto: jest.fn(),
      getPhotoUrl: jest.fn(),
      updatePhotoMetadata: jest.fn(),
      deletePhoto: jest.fn(),
      searchPhotos: jest.fn(),
      getUserPhotos: jest.fn(),
    } as any;

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create photo routes
    photoRoutes = new PhotoRoutes(mockStorage, mockLogger);

    // Setup express app
    app = express();
    app.use(express.json({ limit: '50mb' }));

    // Add request ID middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = 'test-request-id';
      next();
    });

    app.use('/api/v1/photos', photoRoutes.router);

    // Error handler
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      if (err.name === 'ValidationError' || err.constructor.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: {
            type: 'ValidationError',
            message: err.message,
          },
        });
      }

      if (err.name === 'PhotoNotFoundError' || err.constructor.name === 'PhotoNotFoundError') {
        return res.status(404).json({
          success: false,
          error: {
            type: 'PhotoNotFoundError',
            message: err.message,
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          type: 'InternalServerError',
          message: 'Internal server error',
        },
      });
    });

    jest.clearAllMocks();
  });

  describe('POST /', () => {
    const testData = TEST_DATA_BASE64.PHOTO_DATA;
    const storeOptions = {
      originalName: 'test.jpg',
      contentType: 'image/jpeg',
      clientId: 'client123',
      userId: 'user123',
    };

    it('should store photo successfully', async () => {
      const expectedResult = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/presigned-url',
        bucket: 'images',
        size: 1024,
        processing_status: 'completed' as const,
        created_at: '2023-01-01T00:00:00.000Z',
      };

      mockStorage.storePhoto.mockResolvedValue(expectedResult);

      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: testData,
          options: storeOptions,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(expectedResult);
      expect(response.body.meta.requestId).toBe('test-request-id');
      expect(response.body.meta.timestamp).toBeDefined();
      expect(response.body.meta.duration).toBeGreaterThanOrEqual(0);

      expect(mockStorage.storePhoto).toHaveBeenCalledWith(
        Buffer.from(TEST_DATA_BASE64.PHOTO_DATA, 'base64'),
        storeOptions
      );
    });

    it('should return 400 for missing data', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          options: storeOptions,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Missing data or options in request body');
    });

    it('should return 400 for missing options', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: testData,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Missing data or options in request body');
    });

    it('should return 400 for invalid base64 data', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: 'invalid-base64!@#',
          options: storeOptions,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Invalid base64 data format');
    });

    it('should return 400 for non-string data', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: 123,
          options: storeOptions,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Data must be a base64 encoded string');
    });

    it('should return 400 for missing originalName', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: testData,
          options: {
            ...storeOptions,
            originalName: '',
          },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('originalName is required');
    });

    it('should return 400 for missing clientId', async () => {
      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: testData,
          options: {
            ...storeOptions,
            clientId: '',
          },
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('clientId is required');
    });

    it('should return 400 for empty file data', async () => {
      // Use '=' which is a valid base64 string that decodes to empty buffer
      const emptyData = '='; // Valid base64 that decodes to buffer length 0

      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: emptyData,
          options: storeOptions,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Invalid base64 data - empty result');
    });

    it('should handle storage coordinator errors', async () => {
      const error = new Error('Storage failed');
      mockStorage.storePhoto.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/v1/photos')
        .send({
          data: testData,
          options: storeOptions,
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('InternalServerError');
    });
  });

  describe('GET /:id', () => {
    const mockPhoto = {
      id: 'photo1',
      s3_key: 'photos/photo1/test1.jpg',
      s3_url: 'https://minio.test/photos/photo1/test1.jpg',
      bucket: 'photos',
      size: 1024,
      processing_status: 'completed' as const,
      created_at: '2024-01-01T00:00:00Z',
      original_filename: 'test1.jpg',
      mime_type: 'image/jpeg',
      client_id: 'client123',
      uploaded_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    it('should get photo successfully', async () => {
      mockStorage.getPhoto.mockResolvedValue(mockPhoto);

      const response = await request(app).get('/api/v1/photos/photo123').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockPhoto);
      expect(response.body.meta.requestId).toBe('test-request-id');

      expect(mockStorage.getPhoto).toHaveBeenCalledWith('photo123');
    });

    it('should return 404 for non-existent photo', async () => {
      mockStorage.getPhoto.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/photos/nonexistent').expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('PhotoNotFoundError');
      expect(response.body.error.message).toBe('Photo not found: nonexistent');
    });

    it('should handle storage coordinator errors', async () => {
      const error = new Error('Storage failed');
      mockStorage.getPhoto.mockRejectedValue(error);

      const response = await request(app).get('/api/v1/photos/photo123').expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('InternalServerError');
    });
  });

  describe('GET /:id/url', () => {
    it('should get photo URL with default expiry', async () => {
      const expectedUrl = 'https://minio.test/presigned-url';
      mockStorage.getPhotoUrl.mockResolvedValue(expectedUrl);

      const response = await request(app).get('/api/v1/photos/photo123/url').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        url: expectedUrl,
        expiry: 3600,
        photoId: 'photo123',
      });

      expect(mockStorage.getPhotoUrl).toHaveBeenCalledWith('photo123', 3600);
    });

    it('should get photo URL with custom expiry', async () => {
      const expectedUrl = 'https://minio.test/presigned-url';
      mockStorage.getPhotoUrl.mockResolvedValue(expectedUrl);

      const response = await request(app)
        .get('/api/v1/photos/photo123/url?expiry=7200')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.expiry).toBe(7200);

      expect(mockStorage.getPhotoUrl).toHaveBeenCalledWith('photo123', 7200);
    });

    it('should return 400 for excessive expiry', async () => {
      const response = await request(app)
        .get('/api/v1/photos/photo123/url?expiry=100000')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Expiry cannot exceed 86400 seconds (24 hours)');
    });

    it('should handle PhotoNotFoundError', async () => {
      const error = new PhotoNotFoundError('Photo not found: photo123');
      mockStorage.getPhotoUrl.mockRejectedValue(error);

      const response = await request(app).get('/api/v1/photos/photo123/url').expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('PhotoNotFoundError');
    });
  });

  describe('PUT /:id/metadata', () => {
    const metadata = {
      width: 1920,
      height: 1080,
      processing_status: 'completed' as const,
    };

    it('should update photo metadata successfully', async () => {
      mockStorage.updatePhotoMetadata.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/v1/photos/photo123/metadata')
        .send(metadata)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        photoId: 'photo123',
        updatedFields: Object.keys(metadata),
      });

      expect(mockStorage.updatePhotoMetadata).toHaveBeenCalledWith('photo123', metadata);
    });

    it('should return 400 for empty metadata', async () => {
      const response = await request(app)
        .put('/api/v1/photos/photo123/metadata')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('ValidationError');
      expect(response.body.error.message).toBe('Metadata is required');
    });

    it('should handle PhotoNotFoundError', async () => {
      const error = new PhotoNotFoundError('Photo not found: photo123');
      mockStorage.updatePhotoMetadata.mockRejectedValue(error);

      const response = await request(app)
        .put('/api/v1/photos/photo123/metadata')
        .send(metadata)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('PhotoNotFoundError');
    });
  });

  describe('DELETE /:id', () => {
    it('should delete photo successfully', async () => {
      mockStorage.deletePhoto.mockResolvedValue(undefined);

      const response = await request(app).delete('/api/v1/photos/photo123').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        photoId: 'photo123',
        deleted: true,
      });

      expect(mockStorage.deletePhoto).toHaveBeenCalledWith('photo123');
    });

    it('should handle PhotoNotFoundError', async () => {
      const error = new PhotoNotFoundError('Photo not found: photo123');
      mockStorage.deletePhoto.mockRejectedValue(error);

      const response = await request(app).delete('/api/v1/photos/photo123').expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.type).toBe('PhotoNotFoundError');
    });
  });

  describe('POST /search', () => {
    const mockSearchResult = {
      photos: [
        {
          id: 'photo1',
          s3_key: 'photos/photo1/test.jpg',
          s3_url: 'https://minio.test/photo1',
          bucket: 'images',
          size: 1024,
          processing_status: 'completed' as const,
          created_at: '2023-01-01T00:00:00.000Z',
          original_filename: 'test.jpg',
          mime_type: 'image/jpeg',
          client_id: 'client123',
          uploaded_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: {
        limit: 50,
        offset: 0,
        hasMore: false,
      },
      searchTime: 25,
    };

    it('should search photos successfully', async () => {
      mockStorage.searchPhotos.mockResolvedValue(mockSearchResult);

      const searchQuery = {
        query: 'test',
        filters: {
          client_id: 'client123',
        },
        limit: 10,
        offset: 0,
      };

      const response = await request(app)
        .post('/api/v1/photos/search')
        .send(searchQuery)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockSearchResult);

      expect(mockStorage.searchPhotos).toHaveBeenCalledWith({
        ...searchQuery,
        limit: 10, // Should respect the requested limit if under 100
        offset: 0,
      });
    });

    it('should cap limit at 100', async () => {
      mockStorage.searchPhotos.mockResolvedValue(mockSearchResult);

      const searchQuery = {
        query: 'test',
        limit: 200,
        offset: 0,
      };

      const response = await request(app)
        .post('/api/v1/photos/search')
        .send(searchQuery)
        .expect(200);

      expect(mockStorage.searchPhotos).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100, // Should be capped at 100
        })
      );
    });

    it('should use default values for missing parameters', async () => {
      mockStorage.searchPhotos.mockResolvedValue(mockSearchResult);

      const response = await request(app).post('/api/v1/photos/search').send({}).expect(200);

      expect(mockStorage.searchPhotos).toHaveBeenCalledWith({
        limit: 50, // Default limit
        offset: 0, // Default offset
      });
    });

    it('should handle negative offset', async () => {
      mockStorage.searchPhotos.mockResolvedValue(mockSearchResult);

      const response = await request(app)
        .post('/api/v1/photos/search')
        .send({ offset: -10 })
        .expect(200);

      expect(mockStorage.searchPhotos).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: 0, // Should be normalized to 0
        })
      );
    });
  });

  describe('GET /user/:userId', () => {
    const mockUserPhotos = {
      photos: [
        {
          id: 'photo1',
          s3_key: 'photos/photo1/test.jpg',
          s3_url: 'https://minio.test/photo1',
          bucket: 'images',
          size: 1024,
          processing_status: 'completed' as const,
          created_at: '2023-01-01T00:00:00.000Z',
          original_filename: 'test.jpg',
          mime_type: 'image/jpeg',
          client_id: 'client123',
          uploaded_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ],
      pagination: {
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
    };

    it('should get user photos successfully', async () => {
      mockStorage.getUserPhotos.mockResolvedValue(mockUserPhotos);

      const response = await request(app).get('/api/v1/photos/user/user123').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockUserPhotos);

      expect(mockStorage.getUserPhotos).toHaveBeenCalledWith('user123', {
        limit: 50,
        offset: 0,
      });
    });

    it('should handle custom pagination parameters', async () => {
      mockStorage.getUserPhotos.mockResolvedValue(mockUserPhotos);

      const response = await request(app)
        .get('/api/v1/photos/user/user123?limit=20&offset=10')
        .expect(200);

      expect(mockStorage.getUserPhotos).toHaveBeenCalledWith('user123', {
        limit: 20,
        offset: 10,
      });
    });

    it('should cap limit at 100', async () => {
      mockStorage.getUserPhotos.mockResolvedValue(mockUserPhotos);

      const response = await request(app).get('/api/v1/photos/user/user123?limit=200').expect(200);

      expect(mockStorage.getUserPhotos).toHaveBeenCalledWith('user123', {
        limit: 100, // Should be capped at 100
        offset: 0,
      });
    });

    it('should handle negative offset', async () => {
      mockStorage.getUserPhotos.mockResolvedValue(mockUserPhotos);

      const response = await request(app).get('/api/v1/photos/user/user123?offset=-5').expect(200);

      expect(mockStorage.getUserPhotos).toHaveBeenCalledWith('user123', {
        limit: 50,
        offset: 0, // Should be normalized to 0
      });
    });

    it('should handle invalid pagination parameters', async () => {
      mockStorage.getUserPhotos.mockResolvedValue(mockUserPhotos);

      const response = await request(app)
        .get('/api/v1/photos/user/user123?limit=invalid&offset=invalid')
        .expect(200);

      expect(mockStorage.getUserPhotos).toHaveBeenCalledWith('user123', {
        limit: 50, // Should use default
        offset: 0, // Should use default
      });
    });

    it('should handle ValidationError from storage coordinator', async () => {
      const error = new ValidationError('User ID is required');
      mockStorage.getUserPhotos.mockRejectedValue(error);

      const response = await request(app).get('/api/v1/photos/user/').expect(404); // Express will return 404 for missing route parameter
    });
  });

  describe('logging', () => {
    it('should log successful operations', async () => {
      const mockResult = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/presigned-url',
        bucket: 'images',
        size: 15,
        processing_status: 'completed' as const,
        created_at: '2023-01-01T00:00:00.000Z',
      };

      mockStorage.storePhoto.mockResolvedValue(mockResult);

      await request(app)
        .post('/api/v1/photos')
        .send({
          data: TEST_DATA_BASE64.SIMPLE_TEXT,
          options: {
            originalName: 'test.jpg',
            clientId: 'client123',
          },
        })
        .expect(201);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Photo stored via API',
        expect.objectContaining({
          photoId: 'photo123',
          size: 4,
          requestId: 'test-request-id',
          clientId: 'client123',
        })
      );
    });

    it('should log errors', async () => {
      const error = new Error('Storage failed');
      mockStorage.storePhoto.mockRejectedValue(error);

      await request(app)
        .post('/api/v1/photos')
        .send({
          data: TEST_DATA_BASE64.SIMPLE_TEXT,
          options: {
            originalName: 'test.jpg',
            clientId: 'client123',
          },
        })
        .expect(500);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to store photo via API',
        expect.objectContaining({
          error: 'Storage failed',
          requestId: 'test-request-id',
        })
      );
    });
  });
});
