import { StorageCoordinator } from '../coordinator';
import { MinIOClient } from '../minio-client';
import { SQLiteClient } from '../sqlite-client';
import {
  StorageCoordinatorConfig,
  StorePhotoOptions,
  Photo,
  ValidationError,
  PhotoNotFoundError,
} from '../types';

// Mock the dependencies
jest.mock('../minio-client');
jest.mock('../sqlite-client');

const MockedMinIOClient = MinIOClient as jest.MockedClass<typeof MinIOClient>;
const MockedSQLiteClient = SQLiteClient as jest.MockedClass<typeof SQLiteClient>;

describe('StorageCoordinator', () => {
  let coordinator: StorageCoordinator;
  let mockMinioClient: jest.Mocked<MinIOClient>;
  let mockSqliteClient: jest.Mocked<SQLiteClient>;
  let mockTransaction: { commit: jest.Mock; rollback: jest.Mock };
  let config: StorageCoordinatorConfig;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock transaction
    mockTransaction = {
      commit: jest.fn(),
      rollback: jest.fn(),
    };

    // Create mock clients
    mockMinioClient = {
      initialize: jest.fn(),
      putObject: jest.fn(),
      getPresignedUrl: jest.fn(),
      removeObject: jest.fn(),
      generateS3Key: jest.fn(),
      getBucketForContent: jest.fn(),
      isUrlExpired: jest.fn(),
      healthCheck: jest.fn(),
    } as any;

    mockSqliteClient = {
      initialize: jest.fn(),
      beginTransaction: jest.fn().mockResolvedValue(mockTransaction),
      insert: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      close: jest.fn(),
      healthCheck: jest.fn(),
    } as any;

    // Mock constructors
    MockedMinIOClient.mockImplementation(() => mockMinioClient);
    MockedSQLiteClient.mockImplementation(() => mockSqliteClient);

    // Setup config
    config = {
      sqlitePath: ':memory:',
      minioConfig: {
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'test',
        secretKey: 'test',
      },
    };

    coordinator = new StorageCoordinator(config);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);

      await coordinator.initialize();

      expect(mockSqliteClient.initialize).toHaveBeenCalled();
      expect(mockMinioClient.initialize).toHaveBeenCalled();
    });

    it('should throw error if SQLite initialization fails', async () => {
      const error = new Error('SQLite connection failed');
      mockSqliteClient.initialize.mockRejectedValue(error);

      await expect(coordinator.initialize()).rejects.toThrow('SQLite connection failed');
    });

    it('should throw error if MinIO initialization fails', async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      const error = new Error('MinIO connection failed');
      mockMinioClient.initialize.mockRejectedValue(error);

      await expect(coordinator.initialize()).rejects.toThrow('MinIO connection failed');
    });
  });

  describe('storePhoto', () => {
    const photoData = Buffer.from('test photo data');
    const storeOptions: StorePhotoOptions = {
      originalName: 'test.jpg',
      contentType: 'image/jpeg',
      clientId: 'client123',
      sessionId: 'session123',
      userId: 'user123',
      metadata: { custom: 'value' },
    };

    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();

      // Setup default mocks
      mockMinioClient.generateS3Key.mockReturnValue('photos/test-id/test.jpg');
      mockMinioClient.getBucketForContent.mockReturnValue('photos');
      mockMinioClient.getPresignedUrl.mockResolvedValue('https://minio.test/presigned-url');
      mockMinioClient.putObject.mockResolvedValue({
        etag: 'test-etag',
        versionId: null,
      });
      mockSqliteClient.insert.mockResolvedValue(undefined);
      mockTransaction.commit.mockResolvedValue(undefined);
    });

    it('should store photo successfully', async () => {
      const result = await coordinator.storePhoto(photoData, storeOptions);

      expect(result).toMatchObject({
        s3_key: 'photos/test-id/test.jpg',
        s3_url: 'https://minio.test/presigned-url',
        bucket: 'photos',
        size: photoData.length,
        processing_status: 'queued',
      });

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'photos',
        'photos/test-id/test.jpg',
        photoData,
        expect.objectContaining({
          contentType: 'image/jpeg',
          metadata: expect.objectContaining({
            'original-name': 'test.jpg',
            'client-id': 'client123',
            custom: 'value',
          }),
        })
      );

      expect(mockSqliteClient.insert).toHaveBeenCalledWith(
        'photos',
        expect.objectContaining({
          s3_key: 'photos/test-id/test.jpg',
          original_filename: 'test.jpg',
          mime_type: 'image/jpeg',
          client_id: 'client123',
          processing_status: 'queued',
        })
      );

      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it('should rollback transaction on MinIO error', async () => {
      const error = new Error('MinIO upload failed');
      mockMinioClient.putObject.mockRejectedValue(error);

      await expect(coordinator.storePhoto(photoData, storeOptions)).rejects.toThrow(
        'MinIO upload failed'
      );

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });

    it('should rollback transaction on database error', async () => {
      const error = new Error('Database insert failed');
      mockSqliteClient.insert.mockRejectedValue(error);

      await expect(coordinator.storePhoto(photoData, storeOptions)).rejects.toThrow(
        'Database insert failed'
      );

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for empty data', async () => {
      const emptyData = Buffer.from('');

      await expect(coordinator.storePhoto(emptyData, storeOptions)).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.storePhoto(emptyData, storeOptions)).rejects.toThrow(
        'File data cannot be empty'
      );
    });

    it('should throw ValidationError for file too large', async () => {
      const largeData = Buffer.alloc(51 * 1024 * 1024); // 51MB

      await expect(coordinator.storePhoto(largeData, storeOptions)).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.storePhoto(largeData, storeOptions)).rejects.toThrow(
        'File too large'
      );
    });

    it('should throw ValidationError for missing originalName', async () => {
      const invalidOptions = { ...storeOptions, originalName: '' };

      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        ValidationError
      );
    });

    it('should throw ValidationError for missing clientId', async () => {
      const invalidOptions = { ...storeOptions, clientId: '' };

      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        ValidationError
      );
    });

    it('should throw ValidationError for invalid filename', async () => {
      const invalidOptions = { ...storeOptions, originalName: 'test<>.jpg' };

      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        'Invalid characters in filename'
      );
    });

    it('should throw ValidationError for unsupported content type', async () => {
      const invalidOptions = { ...storeOptions, contentType: 'application/exe' };

      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.storePhoto(photoData, invalidOptions)).rejects.toThrow(
        'Unsupported content type'
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedCoordinator = new StorageCoordinator(config);

      await expect(uninitializedCoordinator.storePhoto(photoData, storeOptions)).rejects.toThrow(
        'Storage Coordinator not initialized'
      );
    });
  });

  describe('getPhoto', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should return photo when found', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/valid-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(false);

      const result = await coordinator.getPhoto('photo123');

      expect(result).toEqual(mockPhoto);
      expect(mockSqliteClient.get).toHaveBeenCalledWith('SELECT * FROM photos WHERE id = ?', [
        'photo123',
      ]);
    });

    it('should return null when photo not found', async () => {
      mockSqliteClient.get.mockResolvedValue(null);

      const result = await coordinator.getPhoto('nonexistent');

      expect(result).toBeNull();
    });

    it('should refresh expired URL', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/expired-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const newUrl = 'https://minio.test/new-url';

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(true);
      mockMinioClient.getPresignedUrl.mockResolvedValue(newUrl);
      mockSqliteClient.run.mockResolvedValue({
        changes: 1,
        lastInsertRowid: 1,
      });

      const result = await coordinator.getPhoto('photo123');

      expect(result?.s3_url).toBe(newUrl);
      expect(mockMinioClient.getPresignedUrl).toHaveBeenCalledWith(
        'GET',
        'photos',
        'photos/photo123/test.jpg',
        3600
      );
      expect(mockSqliteClient.run).toHaveBeenCalledWith(
        'UPDATE photos SET s3_url = ?, updated_at = ? WHERE id = ?',
        [newUrl, expect.any(String), 'photo123']
      );
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(coordinator.getPhoto('')).rejects.toThrow(ValidationError);
      await expect(coordinator.getPhoto('')).rejects.toThrow('Photo ID is required');
    });

    it('should throw error if not initialized', async () => {
      const uninitializedCoordinator = new StorageCoordinator(config);

      await expect(uninitializedCoordinator.getPhoto('photo123')).rejects.toThrow(
        'Storage Coordinator not initialized'
      );
    });
  });

  describe('getPhotoUrl', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should return existing URL if not expired', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/valid-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(false);

      const url = await coordinator.getPhotoUrl('photo123');

      expect(url).toBe('https://minio.test/valid-url');
    });

    it('should generate new URL if expired', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/expired-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const newUrl = 'https://minio.test/new-presigned-url';

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(true);
      mockMinioClient.getPresignedUrl.mockResolvedValue(newUrl);

      const url = await coordinator.getPhotoUrl('photo123', 7200);

      expect(url).toBe(newUrl);
      expect(mockMinioClient.getPresignedUrl).toHaveBeenCalledWith(
        'GET',
        'photos',
        'photos/photo123/test.jpg',
        7200
      );
    });

    it('should throw PhotoNotFoundError for nonexistent photo', async () => {
      mockSqliteClient.get.mockResolvedValue(null);

      await expect(coordinator.getPhotoUrl('nonexistent')).rejects.toThrow(PhotoNotFoundError);
      await expect(coordinator.getPhotoUrl('nonexistent')).rejects.toThrow(
        'Photo not found: nonexistent'
      );
    });
  });

  describe('updatePhotoMetadata', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should update photo metadata successfully', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/valid-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(false);
      mockSqliteClient.update.mockResolvedValue(undefined);

      const metadata = {
        width: 1920,
        height: 1080,
        processing_status: 'completed' as const,
      };

      await coordinator.updatePhotoMetadata('photo123', metadata);

      expect(mockSqliteClient.update).toHaveBeenCalledWith(
        'photos',
        expect.objectContaining({
          ...metadata,
          updated_at: expect.any(String),
        }),
        'id = ?',
        ['photo123']
      );
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(coordinator.updatePhotoMetadata('', { width: 100 })).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.updatePhotoMetadata('', { width: 100 })).rejects.toThrow(
        'Photo ID is required'
      );
    });

    it('should throw ValidationError for empty metadata', async () => {
      await expect(coordinator.updatePhotoMetadata('photo123', {})).rejects.toThrow(
        ValidationError
      );
      await expect(coordinator.updatePhotoMetadata('photo123', {})).rejects.toThrow(
        'No metadata provided for update'
      );
    });

    it('should throw PhotoNotFoundError for nonexistent photo', async () => {
      mockSqliteClient.get.mockResolvedValue(null);

      await expect(coordinator.updatePhotoMetadata('nonexistent', { width: 100 })).rejects.toThrow(
        PhotoNotFoundError
      );
    });
  });

  describe('deletePhoto', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should delete photo successfully', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/valid-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(false);
      mockMinioClient.removeObject.mockResolvedValue(undefined);
      mockSqliteClient.delete.mockResolvedValue(undefined);
      mockTransaction.commit.mockResolvedValue(undefined);

      await coordinator.deletePhoto('photo123');

      expect(mockMinioClient.removeObject).toHaveBeenCalledWith(
        'photos',
        'photos/photo123/test.jpg'
      );
      expect(mockSqliteClient.delete).toHaveBeenCalledWith('photos', 'id = ?', ['photo123']);
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it('should rollback transaction on MinIO error', async () => {
      const mockPhoto: Photo = {
        id: 'photo123',
        s3_key: 'photos/photo123/test.jpg',
        s3_url: 'https://minio.test/valid-url',
        bucket: 'photos',
        size: 1024,
        processing_status: 'completed',
        created_at: '2023-01-01T00:00:00.000Z',
        original_filename: 'test.jpg',
        mime_type: 'image/jpeg',
        client_id: 'client123',
        uploaded_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockSqliteClient.get.mockResolvedValue(mockPhoto);
      mockMinioClient.isUrlExpired.mockReturnValue(false);
      const error = new Error('MinIO delete failed');
      mockMinioClient.removeObject.mockRejectedValue(error);

      await expect(coordinator.deletePhoto('photo123')).rejects.toThrow('MinIO delete failed');

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });

    it('should throw ValidationError for empty photoId', async () => {
      await expect(coordinator.deletePhoto('')).rejects.toThrow(ValidationError);
      await expect(coordinator.deletePhoto('')).rejects.toThrow('Photo ID is required');
    });

    it('should throw PhotoNotFoundError for nonexistent photo', async () => {
      mockSqliteClient.get.mockResolvedValue(null);

      await expect(coordinator.deletePhoto('nonexistent')).rejects.toThrow(PhotoNotFoundError);
    });
  });

  describe('searchPhotos', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should search photos with basic query', async () => {
      const mockPhotos: Photo[] = [
        {
          id: 'photo1',
          s3_key: 'photos/photo1/test.jpg',
          s3_url: 'https://minio.test/photo1',
          bucket: 'photos',
          size: 1024,
          processing_status: 'completed',
          created_at: '2023-01-01T00:00:00.000Z',
          original_filename: 'test.jpg',
          mime_type: 'image/jpeg',
          client_id: 'client123',
          uploaded_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockSqliteClient.all.mockResolvedValue(mockPhotos);
      mockSqliteClient.get.mockResolvedValue({ 'COUNT(*)': 1 });

      const searchQuery = {
        query: 'test',
        limit: 10,
        offset: 0,
      };

      const result = await coordinator.searchPhotos(searchQuery);

      expect(result).toMatchObject({
        photos: mockPhotos,
        total: 1,
        page: {
          limit: 10,
          offset: 0,
          hasMore: false,
        },
      });

      expect(result.searchTime).toBeGreaterThanOrEqual(0);
    });

    it('should search photos with filters', async () => {
      mockSqliteClient.all.mockResolvedValue([]);
      mockSqliteClient.get.mockResolvedValue({ 'COUNT(*)': 0 });

      const searchQuery = {
        filters: {
          client_id: 'client123',
          mime_type: ['image/jpeg'],
          processing_status: ['completed'] as const,
          date_range: {
            start: '2023-01-01T00:00:00.000Z',
            end: '2023-12-31T23:59:59.999Z',
          },
          size_range: {
            min: 1000,
            max: 10000,
          },
        },
        sort: {
          field: 'uploaded_at' as const,
          order: 'desc' as const,
        },
        limit: 50,
        offset: 0,
      };

      await coordinator.searchPhotos({
        ...searchQuery,
        filters: {
          ...searchQuery.filters,
          processing_status: ['completed' as const],
        },
      });

      expect(mockSqliteClient.all).toHaveBeenCalled();
    });
  });

  describe('getUserPhotos', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should get user photos with pagination', async () => {
      const mockPhotos: Photo[] = [
        {
          id: 'photo1',
          s3_key: 'photos/photo1/test.jpg',
          s3_url: 'https://minio.test/photo1',
          bucket: 'photos',
          size: 1024,
          processing_status: 'completed',
          created_at: '2023-01-01T00:00:00.000Z',
          original_filename: 'test.jpg',
          mime_type: 'image/jpeg',
          client_id: 'client123',
          uploaded_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockSqliteClient.all.mockResolvedValue(mockPhotos);
      mockSqliteClient.get.mockResolvedValue({ count: 1 });

      const result = await coordinator.getUserPhotos('user123', { limit: 10, offset: 0 });

      expect(result).toMatchObject({
        photos: mockPhotos,
        pagination: {
          total: 1,
          limit: 10,
          offset: 0,
          hasMore: false,
        },
      });

      expect(mockSqliteClient.all).toHaveBeenCalledWith(
        'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        ['user123', 10, 0]
      );
    });

    it('should throw ValidationError for empty userId', async () => {
      await expect(coordinator.getUserPhotos('')).rejects.toThrow(ValidationError);
      await expect(coordinator.getUserPhotos('')).rejects.toThrow('User ID is required');
    });

    it('should cap limit at 100', async () => {
      mockSqliteClient.all.mockResolvedValue([]);
      mockSqliteClient.get.mockResolvedValue({ count: 0 });

      await coordinator.getUserPhotos('user123', { limit: 200 });

      expect(mockSqliteClient.all).toHaveBeenCalledWith(
        'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        ['user123', 100, 0]
      );
    });
  });

  describe('getHealthStatus', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should return healthy status when all services are healthy', async () => {
      mockSqliteClient.healthCheck.mockResolvedValue(true);
      mockMinioClient.healthCheck.mockResolvedValue(true);

      const status = await coordinator.getHealthStatus();

      expect(status).toEqual({
        database: true,
        storage: true,
        overall: true,
      });
    });

    it('should return unhealthy status when database is down', async () => {
      mockSqliteClient.healthCheck.mockResolvedValue(false);
      mockMinioClient.healthCheck.mockResolvedValue(true);

      const status = await coordinator.getHealthStatus();

      expect(status).toEqual({
        database: false,
        storage: true,
        overall: false,
      });
    });

    it('should return unhealthy status when storage is down', async () => {
      mockSqliteClient.healthCheck.mockResolvedValue(true);
      mockMinioClient.healthCheck.mockResolvedValue(false);

      const status = await coordinator.getHealthStatus();

      expect(status).toEqual({
        database: true,
        storage: false,
        overall: false,
      });
    });
  });

  describe('close', () => {
    beforeEach(async () => {
      mockSqliteClient.initialize.mockResolvedValue(undefined);
      mockMinioClient.initialize.mockResolvedValue(undefined);
      await coordinator.initialize();
    });

    it('should close successfully', async () => {
      mockSqliteClient.close.mockResolvedValue(undefined);

      await coordinator.close();

      expect(mockSqliteClient.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      const error = new Error('Close failed');
      mockSqliteClient.close.mockRejectedValue(error);

      // Should not throw, just log the error
      await expect(coordinator.close()).resolves.toBeUndefined();
    });
  });
});
