import * as crypto from 'crypto';
import { MinIOClient } from './minio-client';
import { SQLiteClient, Logger } from './sqlite-client';
import {
  StorageCoordinatorConfig,
  StorePhotoOptions,
  PhotoResult,
  Photo,
  SearchQuery,
  SearchResult,
  PaginationOptions,
  PhotoPage,
  PhotoMetadata,
  ValidationError,
  PhotoNotFoundError,
} from './types';

export class StorageCoordinator {
  private minioClient: MinIOClient;
  private sqliteClient: SQLiteClient;
  private logger: Logger;
  private initialized = false;

  constructor(config: StorageCoordinatorConfig) {
    this.logger = new Logger('StorageCoordinator');
    this.minioClient = new MinIOClient(config.minioConfig, this.logger);
    this.sqliteClient = new SQLiteClient(config.sqlitePath, this.logger);
  }

  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Storage Coordinator...');

      // Initialize SQLite database
      await this.sqliteClient.initialize();

      // Initialize MinIO connection
      await this.minioClient.initialize();

      this.initialized = true;
      this.logger.info('Storage Coordinator initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Storage Coordinator', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    }
  }

  async storePhoto(data: Buffer, options: StorePhotoOptions): Promise<PhotoResult> {
    this.ensureInitialized();
    this.validateStorePhotoOptions(data, options);

    const transaction = await this.sqliteClient.beginTransaction();

    try {
      // Generate unique identifiers
      const photoId = this.generatePhotoId();
      const s3Key = this.minioClient.generateS3Key(photoId, options.originalName);

      // Determine bucket based on content type and size
      const bucket = this.minioClient.getBucketForContent(
        data.length,
        options.contentType || 'application/octet-stream'
      );

      // Calculate checksum for integrity
      const checksum = this.calculateChecksum(data);

      // Store blob in MinIO
      await this.minioClient.putObject(bucket, s3Key, data, {
        contentType: options.contentType || 'application/octet-stream',
        metadata: {
          'original-name': options.originalName,
          'client-id': options.clientId,
          'upload-timestamp': new Date().toISOString(),
          ...(options.metadata || {}),
        },
      });

      // Generate presigned URL
      const s3Url = await this.minioClient.getPresignedUrl('GET', bucket, s3Key, 3600);

      // Store metadata in SQLite
      const photoRecord = {
        id: photoId,
        s3_key: s3Key,
        s3_url: s3Url,
        bucket,
        file_size: data.length,
        mime_type: options.contentType || 'application/octet-stream',
        original_filename: options.originalName,
        checksum,
        client_id: options.clientId,
        session_id: options.sessionId,
        user_id: options.userId,
        processing_status: 'queued',
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await this.sqliteClient.insert('photos', photoRecord);

      // Commit transaction
      await transaction.commit();

      this.logger.info('Photo stored successfully', {
        photoId,
        bucket,
        size: data.length,
        checksum,
      });

      return {
        id: photoId,
        s3_key: s3Key,
        s3_url: s3Url,
        bucket,
        size: data.length,
        checksum,
        processing_status: 'queued',
        created_at: photoRecord.created_at,
      };
    } catch (error) {
      await transaction.rollback();

      this.logger.error('Failed to store photo', {
        error: (error as Error).message,
        size: data.length,
      });

      throw error;
    }
  }

  async getPhoto(photoId: string): Promise<Photo | null> {
    this.ensureInitialized();

    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    try {
      const photo = await this.sqliteClient.get<Photo>('SELECT * FROM photos WHERE id = ?', [
        photoId,
      ]);

      if (!photo) {
        return null;
      }

      // Update URL if expired
      if (this.minioClient.isUrlExpired(photo.s3_url)) {
        const newUrl = await this.minioClient.getPresignedUrl(
          'GET',
          photo.bucket,
          photo.s3_key,
          3600
        );

        await this.sqliteClient.run('UPDATE photos SET s3_url = ?, updated_at = ? WHERE id = ?', [
          newUrl,
          new Date().toISOString(),
          photoId,
        ]);

        photo.s3_url = newUrl;
      }

      return photo;
    } catch (error) {
      this.logger.error('Failed to get photo', {
        photoId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getPhotoUrl(photoId: string, expiry: number = 3600): Promise<string> {
    const photo = await this.getPhoto(photoId);
    if (!photo) {
      throw new PhotoNotFoundError(`Photo not found: ${photoId}`);
    }

    // If URL is not expired, return it
    if (!this.minioClient.isUrlExpired(photo.s3_url)) {
      return photo.s3_url;
    }

    // Generate new presigned URL
    return await this.minioClient.getPresignedUrl('GET', photo.bucket, photo.s3_key, expiry);
  }

  async searchPhotos(query: SearchQuery): Promise<SearchResult> {
    this.ensureInitialized();

    try {
      const startTime = Date.now();
      const { sql, params, countParams } = this.buildSearchQuery(query);

      const photos = await this.sqliteClient.all<Photo>(sql, params);

      // Get total count for pagination
      const countSql = sql
        .replace(/SELECT \*/g, 'SELECT COUNT(*)')
        .replace(/ORDER BY .*/g, '')
        .replace(/LIMIT .*/g, '');
      const countResult = await this.sqliteClient.get<{ 'COUNT(*)': number }>(
        countSql,
        countParams
      );

      return {
        photos,
        total: countResult?.['COUNT(*)'] || 0,
        page: {
          limit: query.limit || 50,
          offset: query.offset || 0,
          hasMore: photos.length === (query.limit || 50),
        },
        searchTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error('Search failed', {
        query,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUserPhotos(userId: string, options: PaginationOptions = {}): Promise<PhotoPage> {
    this.ensureInitialized();

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    try {
      const limit = Math.min(options.limit || 50, 100); // Cap at 100
      const offset = options.offset || 0;

      const photos = await this.sqliteClient.all<Photo>(
        'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
      );

      const countResult = await this.sqliteClient.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM photos WHERE user_id = ?',
        [userId]
      );

      return {
        photos,
        pagination: {
          total: countResult?.count || 0,
          limit,
          offset,
          hasMore: photos.length === limit,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get user photos', {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updatePhotoMetadata(photoId: string, metadata: Partial<PhotoMetadata>): Promise<void> {
    this.ensureInitialized();

    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    if (!metadata || Object.keys(metadata).length === 0) {
      throw new ValidationError('No metadata provided for update');
    }

    try {
      // Check if photo exists
      const existingPhoto = await this.getPhoto(photoId);
      if (!existingPhoto) {
        throw new PhotoNotFoundError(`Photo not found: ${photoId}`);
      }

      // Build update query
      const updateData = {
        ...metadata,
        updated_at: new Date().toISOString(),
      };

      await this.sqliteClient.update('photos', updateData, 'id = ?', [photoId]);

      this.logger.info('Photo metadata updated', { photoId, updates: Object.keys(metadata) });
    } catch (error) {
      this.logger.error('Failed to update photo metadata', {
        photoId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deletePhoto(photoId: string): Promise<void> {
    this.ensureInitialized();

    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    const transaction = await this.sqliteClient.beginTransaction();

    try {
      // Get photo info first
      const photo = await this.getPhoto(photoId);
      if (!photo) {
        throw new PhotoNotFoundError(`Photo not found: ${photoId}`);
      }

      // Delete from MinIO
      await this.minioClient.removeObject(photo.bucket, photo.s3_key);

      // Delete from SQLite
      await this.sqliteClient.delete('photos', 'id = ?', [photoId]);

      await transaction.commit();

      this.logger.info('Photo deleted', { photoId });
    } catch (error) {
      await transaction.rollback();
      this.logger.error('Failed to delete photo', {
        photoId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getHealthStatus(): Promise<{
    database: boolean;
    storage: boolean;
    overall: boolean;
  }> {
    const dbHealth = await this.sqliteClient.healthCheck();
    const storageHealth = await this.minioClient.healthCheck();

    return {
      database: dbHealth,
      storage: storageHealth,
      overall: dbHealth && storageHealth,
    };
  }

  async close(): Promise<void> {
    try {
      await this.sqliteClient.close();
      this.initialized = false;
      this.logger.info('Storage Coordinator closed');
    } catch (error) {
      this.logger.error('Error closing Storage Coordinator', {
        error: (error as Error).message,
      });
    }
  }

  // === PRIVATE METHODS ===

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Storage Coordinator not initialized. Call initialize() first.');
    }
  }

  private generatePhotoId(): string {
    return crypto.randomUUID();
  }

  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private validateStorePhotoOptions(data: Buffer, options: StorePhotoOptions): void {
    if (!data || data.length === 0) {
      throw new ValidationError('File data cannot be empty');
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (data.length > maxSize) {
      throw new ValidationError(`File too large: ${data.length} > ${maxSize} bytes`);
    }

    if (!options.originalName || typeof options.originalName !== 'string') {
      throw new ValidationError('originalName is required and must be a string');
    }

    if (!options.clientId || typeof options.clientId !== 'string') {
      throw new ValidationError('clientId is required and must be a string');
    }

    // Sanitize filename
    if (!/^[\w\-. ]+$/.test(options.originalName)) {
      throw new ValidationError(
        'Invalid characters in filename. Only alphanumeric, dots, dashes, and spaces are allowed'
      );
    }

    // Validate content type if provided
    if (options.contentType) {
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/svg+xml',
        'video/mp4',
        'video/webm',
        'video/ogg',
      ];

      if (!allowedTypes.includes(options.contentType)) {
        throw new ValidationError(`Unsupported content type: ${options.contentType}`);
      }
    }
  }

  private buildSearchQuery(query: SearchQuery): { sql: string; params: any[]; countParams: any[] } {
    let sql = 'SELECT * FROM photos WHERE 1=1';
    const params: any[] = [];
    const countParams: any[] = [];

    // Text search using FTS5 if query is provided
    if (query.query) {
      sql += ` AND id IN (
        SELECT photo_id FROM photos_search
        WHERE photos_search MATCH ?
      )`;
      params.push(`"${query.query}"`);
      countParams.push(`"${query.query}"`);
    }

    // Apply filters
    if (query.filters) {
      const { filters } = query;

      if (filters.client_id) {
        sql += ' AND client_id = ?';
        params.push(filters.client_id);
        countParams.push(filters.client_id);
      }

      if (filters.user_id) {
        sql += ' AND user_id = ?';
        params.push(filters.user_id);
        countParams.push(filters.user_id);
      }

      if (filters.mime_type && filters.mime_type.length > 0) {
        sql += ` AND mime_type IN (${filters.mime_type.map(() => '?').join(',')})`;
        params.push(...filters.mime_type);
        countParams.push(...filters.mime_type);
      }

      if (filters.processing_status && filters.processing_status.length > 0) {
        sql += ` AND processing_status IN (${filters.processing_status.map(() => '?').join(',')})`;
        params.push(...filters.processing_status);
        countParams.push(...filters.processing_status);
      }

      if (filters.date_range) {
        sql += ' AND uploaded_at BETWEEN ? AND ?';
        params.push(filters.date_range.start, filters.date_range.end);
        countParams.push(filters.date_range.start, filters.date_range.end);
      }

      if (filters.size_range) {
        sql += ' AND file_size BETWEEN ? AND ?';
        params.push(filters.size_range.min, filters.size_range.max);
        countParams.push(filters.size_range.min, filters.size_range.max);
      }
    }

    // Apply sorting
    if (query.sort) {
      sql += ` ORDER BY ${query.sort.field} ${query.sort.order.toUpperCase()}`;
    } else {
      sql += ' ORDER BY uploaded_at DESC';
    }

    // Apply pagination
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(Math.min(query.limit, 100)); // Cap at 100

      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    return { sql, params, countParams };
  }
}
