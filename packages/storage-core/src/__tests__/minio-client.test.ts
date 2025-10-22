import { MinIOClient } from '../minio-client';
import { MinioConfig, StorageConnectionError } from '../types';
import { Logger } from '../sqlite-client';
import * as Minio from 'minio';

// Mock the minio library
jest.mock('minio');

const MockedMinioClient = Minio.Client as jest.MockedClass<typeof Minio.Client>;

describe('MinIOClient', () => {
  let minioClient: MinIOClient;
  let mockMinioInstance: jest.Mocked<Minio.Client>;
  let config: MinioConfig;
  let logger: Logger;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock Minio client instance
    mockMinioInstance = {
      listBuckets: jest.fn(),
      bucketExists: jest.fn(),
      makeBucket: jest.fn(),
      putObject: jest.fn(),
      getObject: jest.fn(),
      statObject: jest.fn(),
      removeObject: jest.fn(),
      presignedUrl: jest.fn(),
      listObjects: jest.fn(),
    } as any;

    // Mock the Minio.Client constructor
    MockedMinioClient.mockImplementation(() => mockMinioInstance);

    // Setup config
    config = {
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      region: 'us-east-1',
    };

    logger = new Logger('MinIOClientTest');
    minioClient = new MinIOClient(config, logger);
  });

  describe('constructor', () => {
    it('should create MinIO client with correct configuration', () => {
      expect(MockedMinioClient).toHaveBeenCalledWith({
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        region: 'us-east-1',
      });
    });

    it('should use default region if not provided', () => {
      const configWithoutRegion = { ...config };
      delete configWithoutRegion.region;

      new MinIOClient(configWithoutRegion, logger);

      expect(MockedMinioClient).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
        })
      );
    });

    it('should create default logger if not provided', () => {
      expect(() => new MinIOClient(config)).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      mockMinioInstance.listBuckets.mockResolvedValue([]);
      mockMinioInstance.bucketExists.mockResolvedValue(false);
      mockMinioInstance.makeBucket.mockResolvedValue(undefined);

      await minioClient.initialize();

      expect(mockMinioInstance.listBuckets).toHaveBeenCalled();
      expect(mockMinioInstance.bucketExists).toHaveBeenCalledTimes(4); // images, images-large, videos, files
      expect(mockMinioInstance.makeBucket).toHaveBeenCalledTimes(4);
    });

    it('should handle existing buckets', async () => {
      mockMinioInstance.listBuckets.mockResolvedValue([]);
      mockMinioInstance.bucketExists.mockResolvedValue(true);

      await minioClient.initialize();

      expect(mockMinioInstance.bucketExists).toHaveBeenCalledTimes(4);
      expect(mockMinioInstance.makeBucket).not.toHaveBeenCalled();
    });

    it('should throw StorageConnectionError on connection failure', async () => {
      const error = new Error('Connection failed');
      mockMinioInstance.listBuckets.mockRejectedValue(error);

      await expect(minioClient.initialize()).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.initialize()).rejects.toThrow('Failed to connect to MinIO');
    });
  });

  describe('putObject', () => {
    const testData = Buffer.from('test data');
    const bucket = 'test-bucket';
    const key = 'test-key';
    const options = {
      contentType: 'text/plain',
      metadata: { 'custom-key': 'custom-value' },
    };

    it('should upload object successfully', async () => {
      const uploadResult = { etag: 'test-etag', versionId: null };
      mockMinioInstance.putObject.mockResolvedValue(uploadResult);

      const result = await minioClient.putObject(bucket, key, testData, options);

      expect(result).toEqual(uploadResult);
      expect(mockMinioInstance.putObject).toHaveBeenCalledWith(bucket, key, testData, {
        'Content-Type': 'text/plain',
        'custom-key': 'custom-value',
      });
    });

    it('should throw StorageConnectionError on upload failure', async () => {
      const error = new Error('Upload failed');
      mockMinioInstance.putObject.mockRejectedValue(error);

      await expect(minioClient.putObject(bucket, key, testData, options)).rejects.toThrow(
        StorageConnectionError
      );
      await expect(minioClient.putObject(bucket, key, testData, options)).rejects.toThrow(
        'Failed to upload object'
      );
    });
  });

  describe('getObject', () => {
    const bucket = 'test-bucket';
    const key = 'test-key';

    it('should get object successfully', async () => {
      const testData = Buffer.from('test data');
      const mockStream: any = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => callback(testData), 0);
          } else if (event === 'end') {
            setTimeout(() => callback(), 0);
          }
          return mockStream;
        }),
      };

      mockMinioInstance.getObject.mockResolvedValue(mockStream as any);

      const result = await minioClient.getObject(bucket, key);

      expect(result).toEqual(testData);
      expect(mockMinioInstance.getObject).toHaveBeenCalledWith(bucket, key);
    });

    it('should handle stream errors', async () => {
      const error = new Error('Stream error');
      const mockStream: any = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(error), 0);
          }
          return mockStream;
        }),
      };

      mockMinioInstance.getObject.mockResolvedValue(mockStream as any);

      await expect(minioClient.getObject(bucket, key)).rejects.toThrow(error);
    });

    it('should throw StorageConnectionError on get failure', async () => {
      const error = new Error('Get failed');
      mockMinioInstance.getObject.mockRejectedValue(error);

      await expect(minioClient.getObject(bucket, key)).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.getObject(bucket, key)).rejects.toThrow('Failed to get object');
    });
  });

  describe('statObject', () => {
    const bucket = 'test-bucket';
    const key = 'test-key';

    it('should get object stats successfully', async () => {
      const mockStat = {
        size: 1024,
        etag: 'test-etag',
        lastModified: new Date('2023-01-01'),
        metaData: {
          'content-type': 'text/plain',
          'custom-key': 'custom-value',
        },
      };

      mockMinioInstance.statObject.mockResolvedValue(mockStat);

      const result = await minioClient.statObject(bucket, key);

      expect(result).toEqual({
        bucket,
        key,
        size: 1024,
        etag: 'test-etag',
        lastModified: new Date('2023-01-01'),
        contentType: 'text/plain',
        metadata: {
          'content-type': 'text/plain',
          'custom-key': 'custom-value',
        },
      });
    });

    it('should use default content type if not provided', async () => {
      const mockStat = {
        size: 1024,
        etag: 'test-etag',
        lastModified: new Date('2023-01-01'),
        metaData: {},
      };

      mockMinioInstance.statObject.mockResolvedValue(mockStat);

      const result = await minioClient.statObject(bucket, key);

      expect(result.contentType).toBe('application/octet-stream');
    });

    it('should throw StorageConnectionError on stat failure', async () => {
      const error = new Error('Stat failed');
      mockMinioInstance.statObject.mockRejectedValue(error);

      await expect(minioClient.statObject(bucket, key)).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.statObject(bucket, key)).rejects.toThrow('Failed to stat object');
    });
  });

  describe('removeObject', () => {
    const bucket = 'test-bucket';
    const key = 'test-key';

    it('should remove object successfully', async () => {
      mockMinioInstance.removeObject.mockResolvedValue(undefined);

      await minioClient.removeObject(bucket, key);

      expect(mockMinioInstance.removeObject).toHaveBeenCalledWith(bucket, key);
    });

    it('should throw StorageConnectionError on remove failure', async () => {
      const error = new Error('Remove failed');
      mockMinioInstance.removeObject.mockRejectedValue(error);

      await expect(minioClient.removeObject(bucket, key)).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.removeObject(bucket, key)).rejects.toThrow(
        'Failed to remove object'
      );
    });
  });

  describe('getPresignedUrl', () => {
    const bucket = 'test-bucket';
    const key = 'test-key';

    it('should generate presigned URL successfully', async () => {
      const expectedUrl = 'https://localhost:9000/test-bucket/test-key?signature';
      mockMinioInstance.presignedUrl.mockResolvedValue(expectedUrl);

      const result = await minioClient.getPresignedUrl('GET', bucket, key, 3600);

      expect(result).toBe(expectedUrl);
      expect(mockMinioInstance.presignedUrl).toHaveBeenCalledWith('GET', bucket, key, 3600);
    });

    it('should use default expiry if not provided', async () => {
      const expectedUrl = 'https://localhost:9000/test-bucket/test-key?signature';
      mockMinioInstance.presignedUrl.mockResolvedValue(expectedUrl);

      await minioClient.getPresignedUrl('GET', bucket, key);

      expect(mockMinioInstance.presignedUrl).toHaveBeenCalledWith('GET', bucket, key, 3600);
    });

    it('should throw StorageConnectionError on URL generation failure', async () => {
      const error = new Error('URL generation failed');
      mockMinioInstance.presignedUrl.mockRejectedValue(error);

      await expect(minioClient.getPresignedUrl('GET', bucket, key)).rejects.toThrow(
        StorageConnectionError
      );
      await expect(minioClient.getPresignedUrl('GET', bucket, key)).rejects.toThrow(
        'Failed to generate presigned URL'
      );
    });
  });

  describe('listObjects', () => {
    const bucket = 'test-bucket';

    it('should list objects successfully', async () => {
      const mockObjects = [
        {
          name: 'file1.jpg',
          size: 1024,
          etag: 'etag1',
          lastModified: new Date('2023-01-01'),
        },
        {
          name: 'file2.jpg',
          size: 2048,
          etag: 'etag2',
          lastModified: new Date('2023-01-02'),
        },
      ];

      const mockStream: any = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            mockObjects.forEach(obj => setTimeout(() => callback(obj), 0));
          } else if (event === 'end') {
            setTimeout(() => callback(), 0);
          }
          return mockStream;
        }),
        destroy: jest.fn(),
      };

      mockMinioInstance.listObjects.mockReturnValue(mockStream as any);

      const result = await minioClient.listObjects(bucket);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        bucket,
        key: 'file1.jpg',
        size: 1024,
        etag: 'etag1',
        lastModified: new Date('2023-01-01'),
        contentType: 'application/octet-stream',
      });
    });

    it('should respect maxKeys parameter', async () => {
      const mockObjects = [
        { name: 'file1.jpg', size: 1024, etag: 'etag1', lastModified: new Date() },
        { name: 'file2.jpg', size: 2048, etag: 'etag2', lastModified: new Date() },
      ];

      const mockStream: any = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            mockObjects.forEach(obj => setTimeout(() => callback(obj), 0));
          }
          return mockStream;
        }),
        destroy: jest.fn(),
      };

      mockMinioInstance.listObjects.mockReturnValue(mockStream as any);

      const result = await minioClient.listObjects(bucket, undefined, 1);

      expect(result).toHaveLength(1);
      expect(mockStream.destroy).toHaveBeenCalled();
    });

    it('should handle stream errors', async () => {
      const error = new Error('List error');
      const mockStream: any = {
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(error), 0);
          }
          return mockStream;
        }),
      };

      mockMinioInstance.listObjects.mockReturnValue(mockStream as any);

      await expect(minioClient.listObjects(bucket)).rejects.toThrow(error);
    });

    it('should throw StorageConnectionError on list failure', async () => {
      const error = new Error('List failed');
      mockMinioInstance.listObjects.mockImplementation(() => {
        throw error;
      });

      await expect(minioClient.listObjects(bucket)).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.listObjects(bucket)).rejects.toThrow('Failed to list objects');
    });
  });

  describe('bucketExists', () => {
    const bucket = 'test-bucket';

    it('should return true if bucket exists', async () => {
      mockMinioInstance.bucketExists.mockResolvedValue(true);

      const result = await minioClient.bucketExists(bucket);

      expect(result).toBe(true);
      expect(mockMinioInstance.bucketExists).toHaveBeenCalledWith(bucket);
    });

    it('should return false if bucket does not exist', async () => {
      mockMinioInstance.bucketExists.mockResolvedValue(false);

      const result = await minioClient.bucketExists(bucket);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const error = new Error('Check failed');
      mockMinioInstance.bucketExists.mockRejectedValue(error);

      const result = await minioClient.bucketExists(bucket);

      expect(result).toBe(false);
    });
  });

  describe('createBucket', () => {
    const bucket = 'test-bucket';

    it('should create bucket successfully', async () => {
      mockMinioInstance.makeBucket.mockResolvedValue(undefined);

      await minioClient.createBucket(bucket, 'us-west-2');

      expect(mockMinioInstance.makeBucket).toHaveBeenCalledWith(bucket, 'us-west-2');
    });

    it('should use default region if not provided', async () => {
      mockMinioInstance.makeBucket.mockResolvedValue(undefined);

      await minioClient.createBucket(bucket);

      expect(mockMinioInstance.makeBucket).toHaveBeenCalledWith(bucket, 'us-east-1');
    });

    it('should ignore "bucket already exists" errors', async () => {
      const error = new Error('Bucket already exists');
      (error as any).code = 'BucketAlreadyExists';
      mockMinioInstance.makeBucket.mockRejectedValue(error);

      await expect(minioClient.createBucket(bucket)).resolves.toBeUndefined();
    });

    it('should ignore "bucket already owned by you" errors', async () => {
      const error = new Error('Bucket already owned by you');
      (error as any).code = 'BucketAlreadyOwnedByYou';
      mockMinioInstance.makeBucket.mockRejectedValue(error);

      await expect(minioClient.createBucket(bucket)).resolves.toBeUndefined();
    });

    it('should throw StorageConnectionError on other errors', async () => {
      const error = new Error('Create failed');
      mockMinioInstance.makeBucket.mockRejectedValue(error);

      await expect(minioClient.createBucket(bucket)).rejects.toThrow(StorageConnectionError);
      await expect(minioClient.createBucket(bucket)).rejects.toThrow('Failed to create bucket');
    });
  });

  describe('healthCheck', () => {
    it('should return true when healthy', async () => {
      mockMinioInstance.listBuckets.mockResolvedValue([]);

      const result = await minioClient.healthCheck();

      expect(result).toBe(true);
      expect(mockMinioInstance.listBuckets).toHaveBeenCalled();
    });

    it('should return false when unhealthy', async () => {
      const error = new Error('Health check failed');
      mockMinioInstance.listBuckets.mockRejectedValue(error);

      const result = await minioClient.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('getBucketForContent', () => {
    it('should return "images" for small images', () => {
      const result = minioClient.getBucketForContent(1024 * 1024, 'image/jpeg'); // 1MB

      expect(result).toBe('images');
    });

    it('should return "images-large" for large images', () => {
      const result = minioClient.getBucketForContent(15 * 1024 * 1024, 'image/png'); // 15MB

      expect(result).toBe('images-large');
    });

    it('should return "videos" for video files', () => {
      const result = minioClient.getBucketForContent(5 * 1024 * 1024, 'video/mp4');

      expect(result).toBe('videos');
    });

    it('should return "files" for other content types', () => {
      const result = minioClient.getBucketForContent(1024, 'application/pdf');

      expect(result).toBe('files');
    });

    it('should handle missing content type', () => {
      const result = minioClient.getBucketForContent(1024, '');

      expect(result).toBe('files');
    });
  });

  describe('isUrlExpired', () => {
    it('should return false for non-expired URL', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      const url = `https://localhost:9000/bucket/key?X-Amz-Expires=${futureTimestamp}`;

      const result = minioClient.isUrlExpired(url);

      expect(result).toBe(false);
    });

    it('should return true for expired URL', () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour in past
      const url = `https://localhost:9000/bucket/key?X-Amz-Expires=${pastTimestamp}`;

      const result = minioClient.isUrlExpired(url);

      expect(result).toBe(true);
    });

    it('should return false for URL without expiry parameter', () => {
      const url = 'https://localhost:9000/bucket/key';

      const result = minioClient.isUrlExpired(url);

      expect(result).toBe(false);
    });

    it('should return true for invalid URL', () => {
      const result = minioClient.isUrlExpired('invalid-url');

      expect(result).toBe(true);
    });
  });

  describe('extractKeyFromUrl', () => {
    it('should extract key from valid URL', () => {
      const url = 'https://localhost:9000/bucket/path/to/file.jpg';

      const result = minioClient.extractKeyFromUrl(url);

      expect(result).toBe('path/to/file.jpg');
    });

    it('should handle URL with query parameters', () => {
      const url = 'https://localhost:9000/bucket/path/to/file.jpg?param=value';

      const result = minioClient.extractKeyFromUrl(url);

      expect(result).toBe('path/to/file.jpg');
    });

    it('should return null for URL with only bucket', () => {
      const url = 'https://localhost:9000/bucket/';

      const result = minioClient.extractKeyFromUrl(url);

      expect(result).toBeNull();
    });

    it('should return null for invalid URL', () => {
      const result = minioClient.extractKeyFromUrl('invalid-url');

      expect(result).toBeNull();
    });
  });

  describe('generateS3Key', () => {
    it('should generate valid S3 key', () => {
      const photoId = 'photo-123';
      const originalName = 'test file.jpg';

      const result = minioClient.generateS3Key(photoId, originalName);

      expect(result).toMatch(/^photos\/\d+\/photo-123_test_file\.jpg$/);
    });

    it('should sanitize filename with special characters', () => {
      const photoId = 'photo-123';
      const originalName = 'test@file#with$special%.jpg';

      const result = minioClient.generateS3Key(photoId, originalName);

      expect(result).toMatch(/^photos\/\d+\/photo-123_test_file_with_special_\.jpg$/);
    });

    it('should preserve allowed characters', () => {
      const photoId = 'photo-123';
      const originalName = 'test-file_name.jpg';

      const result = minioClient.generateS3Key(photoId, originalName);

      expect(result).toMatch(/^photos\/\d+\/photo-123_test-file_name\.jpg$/);
    });
  });
});
