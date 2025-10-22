import * as Minio from 'minio';
import { MinioConfig, MinIOObjectInfo, PutObjectOptions, StorageConnectionError } from './types';
import { Logger } from './sqlite-client';

export class MinIOClient {
  private client: Minio.Client;
  private logger: Logger;
  private buckets = new Set<string>();

  constructor(
    private config: MinioConfig,
    logger?: Logger
  ) {
    this.logger = logger || new Logger('MinIOClient');
    this.client = new Minio.Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region || 'us-east-1',
    });
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing MinIO client...');

      // Test connection by listing buckets
      await this.client.listBuckets();

      // Ensure required buckets exist
      await this.ensureBucketsExist(['images', 'images-large', 'videos', 'files']);

      this.logger.info('MinIO client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize MinIO client', {
        error: (error as Error).message,
        endpoint: this.config.endPoint,
      });
      throw new StorageConnectionError(`Failed to connect to MinIO: ${(error as Error).message}`);
    }
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer,
    options: PutObjectOptions
  ): Promise<Minio.UploadedObjectInfo> {
    try {
      const metaData = {
        'Content-Type': options.contentType,
        ...options.metadata,
      };

      const result = await this.client.putObject(bucket, key, data, metaData);

      this.logger.info('Object uploaded to MinIO', {
        bucket,
        key,
        size: data.length,
        etag: result.etag,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to upload object to MinIO', {
        bucket,
        key,
        size: data.length,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to upload object: ${(error as Error).message}`);
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(bucket, key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      this.logger.error('Failed to get object from MinIO', {
        bucket,
        key,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to get object: ${(error as Error).message}`);
    }
  }

  async statObject(bucket: string, key: string): Promise<MinIOObjectInfo> {
    try {
      const stat = await this.client.statObject(bucket, key);

      return {
        bucket,
        key,
        size: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified,
        contentType: stat.metaData?.['content-type'] || 'application/octet-stream',
        metadata: stat.metaData,
      };
    } catch (error) {
      this.logger.error('Failed to stat object in MinIO', {
        bucket,
        key,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to stat object: ${(error as Error).message}`);
    }
  }

  async removeObject(bucket: string, key: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, key);

      this.logger.info('Object removed from MinIO', { bucket, key });
    } catch (error) {
      this.logger.error('Failed to remove object from MinIO', {
        bucket,
        key,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to remove object: ${(error as Error).message}`);
    }
  }

  async getPresignedUrl(
    method: 'GET' | 'PUT' | 'DELETE',
    bucket: string,
    key: string,
    expiry: number = 3600
  ): Promise<string> {
    try {
      const url = await this.client.presignedUrl(method, bucket, key, expiry);

      this.logger.info('Generated presigned URL', {
        bucket,
        key,
        method,
        expiry,
      });

      return url;
    } catch (error) {
      this.logger.error('Failed to generate presigned URL', {
        bucket,
        key,
        method,
        expiry,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(
        `Failed to generate presigned URL: ${(error as Error).message}`
      );
    }
  }

  async listObjects(bucket: string, prefix?: string, maxKeys?: number): Promise<MinIOObjectInfo[]> {
    try {
      const objects: MinIOObjectInfo[] = [];
      const stream = this.client.listObjects(bucket, prefix, false);

      return new Promise((resolve, reject) => {
        let count = 0;

        stream.on('data', obj => {
          if (maxKeys && count >= maxKeys) {
            stream.destroy();
            resolve(objects);
            return;
          }

          objects.push({
            bucket,
            key: obj.name || '',
            size: obj.size,
            etag: obj.etag || '',
            lastModified: obj.lastModified || new Date(),
            contentType: 'application/octet-stream', // Default, actual type would need separate call
          });

          count++;
        });

        stream.on('end', () => resolve(objects));
        stream.on('error', reject);
      });
    } catch (error) {
      this.logger.error('Failed to list objects in MinIO', {
        bucket,
        prefix,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to list objects: ${(error as Error).message}`);
    }
  }

  async bucketExists(bucket: string): Promise<boolean> {
    try {
      return await this.client.bucketExists(bucket);
    } catch (error) {
      this.logger.error('Failed to check if bucket exists', {
        bucket,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async createBucket(bucket: string, region?: string): Promise<void> {
    try {
      await this.client.makeBucket(bucket, region || this.config.region || 'us-east-1');
      this.buckets.add(bucket);

      this.logger.info('Bucket created in MinIO', { bucket, region });
    } catch (error) {
      // Ignore error if bucket already exists
      if (
        (error as any).code === 'BucketAlreadyOwnedByYou' ||
        (error as any).code === 'BucketAlreadyExists'
      ) {
        this.buckets.add(bucket);
        this.logger.info('Bucket already exists', { bucket });
        return;
      }

      this.logger.error('Failed to create bucket in MinIO', {
        bucket,
        region,
        error: (error as Error).message,
      });
      throw new StorageConnectionError(`Failed to create bucket: ${(error as Error).message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.listBuckets();
      return true;
    } catch (error) {
      this.logger.error('MinIO health check failed', { error: (error as Error).message });
      return false;
    }
  }

  getBucketForContent(size: number, contentType: string): string {
    const type = contentType || 'application/octet-stream';

    if (type.startsWith('image/')) {
      if (size > 10 * 1024 * 1024) {
        // > 10MB
        return 'images-large';
      }
      return 'images';
    }

    if (type.startsWith('video/')) {
      return 'videos';
    }

    return 'files';
  }

  private async ensureBucketsExist(buckets: string[]): Promise<void> {
    for (const bucket of buckets) {
      const exists = await this.bucketExists(bucket);
      if (!exists) {
        await this.createBucket(bucket);
      } else {
        this.buckets.add(bucket);
      }
    }
  }

  // Utility methods for URL parsing and validation
  isUrlExpired(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const expires = urlObj.searchParams.get('X-Amz-Expires');
      if (!expires) return false;

      const expiryTime = parseInt(expires) * 1000;
      return Date.now() > expiryTime;
    } catch {
      return true;
    }
  }

  extractKeyFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);

      // Remove bucket name (first part) to get the key
      if (pathParts.length > 1) {
        return pathParts.slice(1).join('/');
      }

      return null;
    } catch {
      return null;
    }
  }

  generateS3Key(photoId: string, originalName: string): string {
    const timestamp = Date.now();
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');

    return `photos/${timestamp}/${photoId}_${sanitizedName}`;
  }
}
