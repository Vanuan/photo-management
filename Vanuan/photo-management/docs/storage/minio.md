# MinIO Storage Layer Documentation

## Overview

MinIO serves as the object storage backend for the Storage Layer, providing S3-compatible blob storage for photos, videos, and other media files. It handles file storage, retrieval, presigned URLs, and bucket management with high performance and scalability.

## Table of Contents

- [Architecture & Configuration](#architecture--configuration)
- [Bucket Strategy](#bucket-strategy)
- [File Operations](#file-operations)
- [URL Management](#url-management)
- [Security & Access Control](#security--access-control)
- [Performance Optimization](#performance-optimization)
- [Monitoring & Health Checks](#monitoring--health-checks)
- [Implementation Details](#implementation-details)

---

## Architecture & Configuration

### MinIO Client Setup

```typescript
// @shared-infra/storage-core/src/minio-client.ts

import { Client as MinioClient } from 'minio';
import { Logger } from './logger';

export class MinIOClient {
  private client: MinioClient;
  private logger: Logger;
  private config: MinioConfig;
  
  constructor(config: MinioConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    
    this.client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }
  
  async initialize(): Promise<void> {
    try {
      // Test connection
      await this.client.listBuckets();
      
      // Ensure required buckets exist
      await this.ensureBucketsExist();
      
      // Set bucket policies
      await this.configureBucketPolicies();
      
      this.logger.info('MinIO client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize MinIO client', {
        error: error.message,
        endpoint: this.config.endPoint
      });
      throw error;
    }
  }
}
```

### Configuration Interface

```typescript
export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export interface MinioClientConfig extends MinioConfig {
  buckets: BucketConfig[];
  presignedUrlExpiry: number;
  uploadTimeout: number;
  partSize: number;
}

export interface BucketConfig {
  name: string;
  region?: string;
  versioning?: boolean;
  encryption?: boolean;
  lifecycle?: LifecycleRule[];
}
```

### Environment Configuration

```bash
# MinIO Server Configuration
MINIO_ENDPOINT=minio.example.com
MINIO_PORT=9000
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_REGION=us-east-1

# Client Configuration
MINIO_UPLOAD_TIMEOUT=300000
MINIO_PART_SIZE=67108864
MINIO_PRESIGNED_URL_EXPIRY=3600
```

---

## Bucket Strategy

### Bucket Organization

```typescript
export class BucketManager {
  private static readonly BUCKET_MAPPING = {
    'image/jpeg': 'images',
    'image/png': 'images', 
    'image/gif': 'images',
    'image/webp': 'images',
    'image/bmp': 'images',
    'video/mp4': 'videos',
    'video/quicktime': 'videos',
    'video/webm': 'videos',
    'application/pdf': 'documents',
    'default': 'files'
  };
  
  static determineBucket(data: Buffer, contentType?: string): string {
    const size = data.length;
    const type = contentType || 'application/octet-stream';
    
    // Large images go to separate bucket
    if (type.startsWith('image/') && size > 10 * 1024 * 1024) {
      return 'images-large';
    }
    
    return this.BUCKET_MAPPING[type] || this.BUCKET_MAPPING.default;
  }
  
  static generateS3Key(photoId: string, originalName: string): string {
    const timestamp = Date.now();
    const extension = originalName.split('.').pop() || '';
    const datePath = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    
    return `photos/${datePath}/${timestamp}/${photoId}.${extension}`;
  }
}
```

### Bucket Initialization

```typescript
async ensureBucketsExist(): Promise<void> {
  const requiredBuckets = [
    'images',
    'images-large', 
    'videos',
    'documents',
    'files',
    'thumbnails'
  ];
  
  for (const bucketName of requiredBuckets) {
    try {
      const exists = await this.client.bucketExists(bucketName);
      
      if (!exists) {
        await this.client.makeBucket(bucketName, this.config.region);
        this.logger.info(`Created bucket: ${bucketName}`);
      }
      
      // Configure bucket settings
      await this.configureBucket(bucketName);
      
    } catch (error) {
      this.logger.error(`Failed to ensure bucket exists: ${bucketName}`, {
        error: error.message
      });
      throw error;
    }
  }
}

private async configureBucket(bucketName: string): Promise<void> {
  // Set versioning (optional)
  if (this.shouldEnableVersioning(bucketName)) {
    await this.client.setBucketVersioning(bucketName, { Status: 'Enabled' });
  }
  
  // Set lifecycle policies
  const lifecycleConfig = this.getLifecycleConfig(bucketName);
  if (lifecycleConfig) {
    await this.client.setBucketLifecycle(bucketName, lifecycleConfig);
  }
  
  // Set encryption (optional)
  if (this.shouldEnableEncryption(bucketName)) {
    await this.client.setBucketEncryption(bucketName, {
      Rule: [{
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: 'AES256'
        }
      }]
    });
  }
}
```

---

## File Operations

### Upload Operations

```typescript
export class MinIOClient {
  async putObject(
    bucket: string,
    key: string,
    data: Buffer,
    metadata: ObjectMetadata = {}
  ): Promise<UploadResult> {
    const startTime = Date.now();
    
    try {
      const options = {
        'Content-Type': metadata.contentType || 'application/octet-stream',
        'Content-Length': data.length,
        ...this.buildMetadataHeaders(metadata)
      };
      
      const result = await this.client.putObject(bucket, key, data, options);
      
      this.logger.info('Object uploaded successfully', {
        bucket,
        key,
        size: data.length,
        duration: Date.now() - startTime,
        etag: result.etag
      });
      
      return {
        bucket,
        key,
        etag: result.etag,
        size: data.length,
        uploadedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Failed to upload object', {
        bucket,
        key,
        size: data.length,
        error: error.message,
        duration: Date.now() - startTime
      });
      throw new MinIOError(`Upload failed: ${error.message}`, {
        bucket,
        key,
        operation: 'putObject'
      });
    }
  }
  
  async putObjectMultipart(
    bucket: string,
    key: string,
    data: Buffer,
    metadata: ObjectMetadata = {}
  ): Promise<UploadResult> {
    const partSize = this.config.partSize || 64 * 1024 * 1024; // 64MB
    
    if (data.length <= partSize) {
      return this.putObject(bucket, key, data, metadata);
    }
    
    try {
      // Initiate multipart upload
      const uploadId = await this.client.initiateNewMultipartUpload(
        bucket,
        key,
        {
          'Content-Type': metadata.contentType || 'application/octet-stream',
          ...this.buildMetadataHeaders(metadata)
        }
      );
      
      const parts: any[] = [];
      const totalParts = Math.ceil(data.length / partSize);
      
      // Upload parts in parallel (with concurrency limit)
      const concurrency = 3;
      for (let i = 0; i < totalParts; i += concurrency) {
        const batch = [];
        
        for (let j = i; j < Math.min(i + concurrency, totalParts); j++) {
          const start = j * partSize;
          const end = Math.min(start + partSize, data.length);
          const partData = data.slice(start, end);
          
          batch.push(
            this.client.uploadPart(bucket, key, uploadId, j + 1, partData)
              .then(result => ({ partNumber: j + 1, etag: result.etag }))
          );
        }
        
        const batchResults = await Promise.all(batch);
        parts.push(...batchResults);
      }
      
      // Complete multipart upload
      const result = await this.client.completeMultipartUpload(
        bucket,
        key,
        uploadId,
        parts.sort((a, b) => a.partNumber - b.partNumber)
      );
      
      this.logger.info('Multipart upload completed', {
        bucket,
        key,
        size: data.length,
        parts: totalParts,
        etag: result.etag
      });
      
      return {
        bucket,
        key,
        etag: result.etag,
        size: data.length,
        uploadedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Multipart upload failed', {
        bucket,
        key,
        error: error.message
      });
      throw error;
    }
  }
  
  private buildMetadataHeaders(metadata: ObjectMetadata): Record<string, string> {
    const headers: Record<string, string> = {};
    
    if (metadata.metadata) {
      Object.entries(metadata.metadata).forEach(([key, value]) => {
        headers[`X-Amz-Meta-${key}`] = String(value);
      });
    }
    
    return headers;
  }
}
```

### Download Operations

```typescript
async getObject(bucket: string, key: string): Promise<Buffer> {
  try {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      throw new ObjectNotFoundError(`Object not found: ${bucket}/${key}`);
    }
    throw error;
  }
}

async getObjectStream(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
  try {
    return await this.client.getObject(bucket, key);
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      throw new ObjectNotFoundError(`Object not found: ${bucket}/${key}`);
    }
    throw error;
  }
}

async getObjectInfo(bucket: string, key: string): Promise<ObjectInfo> {
  try {
    const stat = await this.client.statObject(bucket, key);
    
    return {
      bucket,
      key,
      size: stat.size,
      etag: stat.etag,
      lastModified: stat.lastModified,
      contentType: stat.metaData['content-type'],
      metadata: this.parseMetadataHeaders(stat.metaData)
    };
    
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      throw new ObjectNotFoundError(`Object not found: ${bucket}/${key}`);
    }
    throw error;
  }
}
```

### Delete Operations

```typescript
async removeObject(bucket: string, key: string): Promise<void> {
  try {
    await this.client.removeObject(bucket, key);
    
    this.logger.info('Object deleted', { bucket, key });
    
  } catch (error) {
    if (error.code === 'NoSuchKey') {
      this.logger.warn('Attempted to delete non-existent object', { bucket, key });
      return; // Idempotent operation
    }
    
    this.logger.error('Failed to delete object', {
      bucket,
      key,
      error: error.message
    });
    throw error;
  }
}

async removeObjects(bucket: string, keys: string[]): Promise<BatchDeleteResult> {
  const results: BatchDeleteResult = {
    deleted: [],
    errors: []
  };
  
  try {
    const deleteResult = await this.client.removeObjects(bucket, keys);
    
    for await (const result of deleteResult) {
      if (result.error) {
        results.errors.push({
          key: result.name,
          error: result.error.message
        });
      } else {
        results.deleted.push(result.name);
      }
    }
    
    this.logger.info('Batch delete completed', {
      bucket,
      total: keys.length,
      deleted: results.deleted.length,
      errors: results.errors.length
    });
    
  } catch (error) {
    this.logger.error('Batch delete failed', {
      bucket,
      keys: keys.length,
      error: error.message
    });
    throw error;
  }
  
  return results;
}
```

---

## URL Management

### Presigned URLs

```typescript
export class URLManager {
  constructor(private client: MinioClient, private config: MinioConfig) {}
  
  async getPresignedUrl(
    method: 'GET' | 'PUT' | 'DELETE',
    bucket: string,
    key: string,
    expiresIn: number = 3600,
    reqParams?: Record<string, any>
  ): Promise<string> {
    try {
      const url = await this.client.presignedUrl(
        method,
        bucket,
        key,
        expiresIn,
        reqParams
      );
      
      this.logger.debug('Generated presigned URL', {
        method,
        bucket,
        key,
        expiresIn
      });
      
      return url;
      
    } catch (error) {
      this.logger.error('Failed to generate presigned URL', {
        method,
        bucket,
        key,
        error: error.message
      });
      throw error;
    }
  }
  
  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    expiresIn: number = 300
  ): Promise<PresignedUploadUrl> {
    const policy = {
      conditions: [
        ['eq', '$bucket', bucket],
        ['eq', '$key', key],
        ['eq', '$Content-Type', contentType],
        ['content-length-range', 1, 50 * 1024 * 1024] // Max 50MB
      ]
    };
    
    const result = await this.client.presignedPostPolicy(policy);
    
    return {
      url: result.postURL,
      fields: result.formData,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }
  
  isUrlExpired(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const expires = urlObj.searchParams.get('X-Amz-Expires');
      const date = urlObj.searchParams.get('X-Amz-Date');
      
      if (!expires || !date) return true;
      
      const expiryTime = new Date(date).getTime() + parseInt(expires) * 1000;
      return Date.now() > expiryTime;
      
    } catch (error) {
      return true;
    }
  }
  
  async refreshUrl(
    bucket: string,
    key: string,
    currentUrl: string,
    expiresIn: number = 3600
  ): Promise<string> {
    if (!this.isUrlExpired(currentUrl)) {
      return currentUrl;
    }
    
    return this.getPresignedUrl('GET', bucket, key, expiresIn);
  }
}
```

### URL Caching Strategy

```typescript
export class URLCache {
  private cache = new Map<string, CachedUrl>();
  
  private getCacheKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }
  
  async getUrl(
    bucket: string,
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const cacheKey = this.getCacheKey(bucket, key);
    const cached = this.cache.get(cacheKey);
    
    // Return cached URL if still valid (with 5-minute buffer)
    if (cached && cached.expiresAt > Date.now() + 300000) {
      return cached.url;
    }
    
    // Generate new URL
    const url = await this.urlManager.getPresignedUrl('GET', bucket, key, expiresIn);
    
    // Cache with expiry
    this.cache.set(cacheKey, {
      url,
      expiresAt: Date.now() + (expiresIn * 1000) - 300000 // 5-minute buffer
    });
    
    return url;
  }
  
  invalidate(bucket: string, key: string): void {
    const cacheKey = this.getCacheKey(bucket, key);
    this.cache.delete(cacheKey);
  }
  
  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (cached.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
```

---

## Security & Access Control

### Bucket Policies

```typescript
export class SecurityManager {
  async configureBucketPolicies(): Promise<void> {
    const policies = {
      'images': this.getImagesBucketPolicy(),
      'videos': this.getVideosBucketPolicy(),
      'documents': this.getDocumentsBucketPolicy()
    };
    
    for (const [bucket, policy] of Object.entries(policies)) {
      try {
        await this.client.setBucketPolicy(bucket, JSON.stringify(policy));
        this.logger.info(`Set bucket policy for: ${bucket}`);
      } catch (error) {
        this.logger.error(`Failed to set bucket policy for: ${bucket}`, {
          error: error.message
        });
      }
    }
  }
  
  private getImagesBucketPolicy() {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: ['arn:aws:s3:::images/*'],
          Condition: {
            StringEquals: {
              's3:ExistingObjectTag/public': 'true'
            }
          }
        },
        {
          Effect: 'Deny',
          Principal: { AWS: ['*'] },
          Action: ['s3:*'],
          Resource: ['arn:aws:s3:::images/*'],
          Condition: {
            StringNotEquals: {
              'aws:PrincipalServiceName': ['storage-service']
            }
          }
        }
      ]
    };
  }
}
```

### Access Control

```typescript
export class AccessController {
  async validateAccess(
    operation: string,
    bucket: string,
    key: string,
    clientId: string,
    userId?: string
  ): Promise<boolean> {
    // Check if client has access to bucket
    if (!this.isClientAuthorized(clientId, bucket)) {
      return false;
    }
    
    // Check object-specific permissions
    if (operation === 'DELETE' || operation === 'PUT') {
      return this.hasWriteAccess(clientId, userId, bucket, key);
    }
    
    if (operation === 'GET') {
      return this.hasReadAccess(clientId, userId, bucket, key);
    }
    
    return false;
  }
  
  private async hasReadAccess(
    clientId: string,
    userId: string | undefined,
    bucket: string,
    key: string
  ): Promise<boolean> {
    // Check object metadata for access control
    try {
      const objectInfo = await this.client.statObject(bucket, key);
      const ownerClientId = objectInfo.metaData['x-amz-meta-client-id'];
      const ownerUserId = objectInfo.metaData['x-amz-meta-user-id'];
      
      // Client must match
      if (ownerClientId !== clientId) {
        return false;
      }
      
      // If object has user restriction, user must match
      if (ownerUserId && ownerUserId !== userId) {
        return false;
      }
      
      return true;
      
    } catch (error) {
      return false;
    }
  }
}
```

---

## Performance Optimization

### Connection Pooling

```typescript
export class MinIOConnectionPool {
  private pool: MinioClient[] = [];
  private readonly maxConnections = 10;
  private readonly minConnections = 2;
  private activeConnections = 0;
  
  async getConnection(): Promise<MinioClient> {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    
    if (this.activeConnections < this.maxConnections) {
      return this.createConnection();
    }
    
    // Wait for connection to be available
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }
  
  async releaseConnection(connection: MinioClient): Promise<void> {
    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      resolve(connection);
      return;
    }
    
    this.pool.push(connection);
  }
  
  private createConnection(): MinioClient {
    this.activeConnections++;
    return new MinioClient(this.config);
  }
}
```

### Batch Operations

```typescript
export class BatchOperationsManager {
  async uploadBatch(uploads: BatchUploadRequest[]): Promise<BatchUploadResult> {
    const concurrency = 5;
    const results: BatchUploadResult = {
      successful: [],
      failed: []
    };
    
    for (let i = 0; i < uploads.length; i += concurrency) {
      const batch = uploads.slice(i, i + concurrency);
      
      const promises = batch.map(async (upload) => {
        try {
          const result = await this.client.putObject(
            upload.bucket,
            upload.key,
            upload.data,
            upload.metadata
          );
          
          results.successful.push({
            bucket: upload.bucket,
            key: upload.key,
            etag: result.etag
          });
          
        } catch (error) {
          results.failed.push({
            bucket: upload.bucket,
            key: upload.key,
            error: error.message
          });
        }
      });
      
      await Promise.all(promises);
    }
    
    return results;
  }
}
```

### Caching Strategy

```typescript
export class MinIOCacheManager {
  private objectInfoCache = new Map<string, CachedObjectInfo>();
  private urlCache = new Map<string, CachedUrl>();
  
  async getObjectInfoCached(bucket: string, key: string): Promise<ObjectInfo> {
    const cacheKey = `${bucket}/${key}`;
    const cached = this.objectInfoCache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return cached.info;
    }
    
    const info = await this.client.statObject(bucket, key);
    
    this.objectInfoCache.set(cacheKey, {
      info,
      expiresAt: Date.now() + 300000 // 5 minutes
    });
    
    return info;
  }
  
  invalidateObjectCache(bucket: string, key: string): void {
    const cacheKey = `${bucket}/${key}`;
    this.objectInfoCache.delete(cacheKey);
    this.urlCache.delete(cacheKey);
  }
}
```

---

## Monitoring & Health Checks

### Health Check Implementation

```typescript
export class MinIOHealthCheck {
  constructor(private client: MinioClient, private logger: Logger) {}
  
  async performHealthCheck(): Promise<HealthCheckResult> {
    const checks = {
      connectivity: await this.checkConnectivity(),
      bucketAccess: await this.checkBucketAccess(),
      uploadCapability: await this.checkUploadCapability(),
      downloadCapability: await this.checkDownloadCapability()
    };
    
    const isHealthy = Object.values(checks).every(check => check.status === 'ok');
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date().toISOString()
    };
  }
  
  private async checkConnectivity(): Promise<HealthCheck> {
    try {
      await this.client.listBuckets();
      return { status: 'ok', message: 'Connection successful' };
    } catch (error) {
      return { status: 'error', message: `Connection failed: ${error.message}` };
    }
  }
  
  private async checkBucketAccess(): Promise<HealthCheck> {
    try {
      const buckets = ['images', 'videos', 'documents'];
      const results = await Promise.all(
        buckets.map(bucket => this.client.bucketExists(bucket))
      );
      
      const allExist = results.every(exists => exists);
      return allExist 
        ? { status: 'ok', message: 'All required buckets accessible' }
        : { status: 'error', message: 'Some required buckets missing' };
        
    } catch (error) {
      return { status: 'error', message: `Bucket access failed: ${error.message}` };
    }
  }
  
  private async checkUploadCapability(): Promise<HealthCheck> {
    const testKey = `health-check-${Date.now()}`;
    const testData = Buffer.from('health-check-test-data');
    
    try {
      await this.client.putObject('images', testKey, testData);
      await this.client.removeObject('images', testKey);
      
      return { status: 'ok', message: 'Upload/delete capability verified' };
    } catch (error) {
      return { status: 'error', message: `Upload test failed: ${error.message}` };
    }
  }
  
  private async checkDownloadCapability(): Promise<HealthCheck> {
    // Create a permanent test object for download testing
    const testKey = 'health-check/test-file';
    
    try {
      // Ensure test object exists
      try {
        await this.client.statObject('images', testKey);
      } catch (error) {
        if (error.code === 'NoSuchKey') {
          await this.client.putObject('images', testKey, Buffer.from('test'));
        }
      }
      
      // Test download
      await this.client.getObject('images', testKey);
      
      return { status: 'ok', message: 'Download capability verified' };
    } catch (error) {
      return { status: 'error', message: `Download test failed: ${error.message}` };
    }
  }
}
```

### Metrics Collection

```typescript
export class MinIOMetrics {
  private metrics: MetricsCollector;
  
  constructor(private client: MinioClient) {
    this.metrics = new MetricsCollector();
  }
  
  async collectMetrics(): Promise<void> {
    // Collect bucket metrics
    await this.collectBucketMetrics();
    
    // Collect operation metrics
    this.collectOperationMetrics();
    
    // Collect performance metrics
    this.collectPerformanceMetrics();
  }
  
  private async collectBucketMetrics(): Promise<void> {
    try {
      const buckets = await this.client.listBuckets();
      
      for (const bucket of buckets) {
        // Get object count and size (this is expensive, consider caching)
        let objectCount = 0;
        let totalSize = 0;
        
        const objectStream = this.client.listObjects(bucket.name, '', true);
        
        for await (const obj of objectStream) {
          objectCount++;
          totalSize += obj.size || 0;
        }
        
        this.metrics.recordGauge('minio_bucket_objects_total', objectCount, {
          bucket: bucket.name
        });
        
        this.metrics.recordGauge('minio_bucket_size_bytes', totalSize, {
          bucket: bucket.name
        });
      }
    } catch (error) {
      this.logger.error('Failed to collect bucket metrics', {
        error: error.message
      });
    }
  }
  
  recordOperationMetric(operation: string, duration: number, success: boolean): void {
    this.metrics.recordHistogram('minio_operation_duration_ms', duration, {
      operation,
      success: success.toString()
    });
    
    this.metrics.incrementCounter('minio_operations_total', {
      operation,
      success: success.toString()
    });
  }
}
```

---

## Implementation Details

### Error Handling

```typescript
export class MinIOError extends Error {
  constructor(
    message: string,
    public context?: {
      bucket?: string;
      key?: string;
      operation?: string;
      originalError?: Error;
    }
  ) {
    super(message);
    this.name = 'MinIOError';
  }
}

export class ObjectNotFoundError extends MinIOError {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectNotFoundError';
  }
}

export class BucketNotFoundError extends MinIOError {
  constructor(message: string) {
    super(message);
    this.name = 'BucketNotFoundError';
  }
}

// Error handler wrapper
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  operation: string
) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error.code === 'NoSuchKey') {
        throw new ObjectNotFoundError(`Object not found: ${error.message}`);
      }
      
      if (error.code === 'NoSuchBucket')