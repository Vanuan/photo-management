import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig } from 'axios';
import * as Minio from 'minio';
import {
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
  StorageConnectionError,
} from '@shared-infra/storage-core';
import { CacheManager } from './cache';
import { Logger } from './logger';

// Extend AxiosRequestConfig to include metadata
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      startTime: number;
    };
  }
}

export interface StorageClientConfig {
  storageServiceUrl: string;
  minioConfig: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    region?: string;
  };
  cacheConfig?: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    backoffFactor: number;
  };
  timeout?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    duration?: number;
  };
}

export class StorageClient {
  private httpClient: AxiosInstance;
  private minioClient: Minio.Client;
  private cache: CacheManager;
  private logger: Logger;
  private retryConfig: {
    maxRetries: number;
    retryDelay: number;
    backoffFactor: number;
  };

  constructor(private config: StorageClientConfig) {
    this.logger = new Logger('StorageClient');
    this.validateConfig(config);

    // Initialize HTTP client for service communication
    this.httpClient = axios.create({
      baseURL: config.storageServiceUrl,
      timeout: config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StorageClient/1.0.0',
      },
    });

    // Initialize MinIO client for direct access
    this.minioClient = new Minio.Client({
      endPoint: config.minioConfig.endPoint,
      port: config.minioConfig.port,
      useSSL: config.minioConfig.useSSL,
      accessKey: config.minioConfig.accessKey,
      secretKey: config.minioConfig.secretKey,
      region: config.minioConfig.region || 'us-east-1',
    });

    // Initialize cache
    this.cache = new CacheManager(
      config.cacheConfig || {
        enabled: true,
        ttl: 300,
        maxSize: 1000,
      }
    );

    // Configure retry settings
    this.retryConfig = config.retryConfig || {
      maxRetries: 3,
      retryDelay: 1000,
      backoffFactor: 2,
    };

    this.setupInterceptors();
  }

  async storePhoto(data: Buffer, options: StorePhotoOptions): Promise<PhotoResult> {
    this.validateStorePhotoOptions(data, options);

    try {
      const base64Data = data.toString('base64');

      const response = await this.retryRequest<PhotoResult>(async () => {
        return await this.httpClient.post<ApiResponse<PhotoResult>>('/api/v1/photos', {
          data: base64Data,
          options,
        });
      });

      const result = response.data.data;

      // Don't cache the PhotoResult from store operation since it's incomplete
      // Only cache full Photo records from getPhoto operations

      this.logger.info('Photo stored successfully', {
        photoId: result.id,
        size: data.length,
        clientId: options.clientId,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to store photo', {
        error: (error as Error).message,
        size: data.length,
        clientId: options.clientId,
      });
      throw this.handleError(error, 'Failed to store photo');
    }
  }

  async getPhoto(photoId: string): Promise<Photo | null> {
    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    try {
      // Check cache first
      if (this.cache.isEnabled()) {
        const cached = (await this.cache.get(`photo:${photoId}`)) as Photo | null;
        if (cached) {
          this.logger.info('Photo retrieved from cache', { photoId });
          return cached;
        }
      }

      const response = await this.retryRequest<Photo>(async () => {
        return await this.httpClient.get<ApiResponse<Photo>>(`/api/v1/photos/${photoId}`);
      });

      const photo = response.data.data;

      // Cache the result
      if (this.cache.isEnabled()) {
        await this.cache.set(`photo:${photoId}`, photo, this.cache.getTTL());
      }

      this.logger.info('Photo retrieved from service', { photoId });
      return photo;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }

      this.logger.error('Failed to get photo', {
        photoId,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to get photo');
    }
  }

  async getPhotoUrl(photoId: string, expiry: number = 3600): Promise<string> {
    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    if (expiry > 86400) {
      throw new ValidationError('Expiry cannot exceed 86400 seconds (24 hours)');
    }

    try {
      // First try to get from cache if URL is still valid
      const cacheKey = `url:${photoId}:${expiry}`;
      if (this.cache.isEnabled()) {
        const cachedUrl = await this.cache.get(cacheKey);
        if (cachedUrl && !this.isUrlExpired(cachedUrl as string)) {
          this.logger.info('Photo URL retrieved from cache', { photoId });
          return cachedUrl as string;
        }
      }

      // Get photo metadata to check if we can generate URL directly
      const photo = await this.getPhoto(photoId);
      if (!photo) {
        throw new PhotoNotFoundError(`Photo not found: ${photoId}`);
      }

      // Generate presigned URL directly from MinIO for better performance
      const url = await this.minioClient.presignedUrl('GET', photo.bucket, photo.s3_key, expiry);

      // Cache the URL with appropriate TTL
      if (this.cache.isEnabled()) {
        const urlTtl = Math.min(expiry - 60, this.cache.getTTL()); // Cache for slightly less than expiry
        if (urlTtl > 0) {
          await this.cache.set(cacheKey, url, urlTtl);
        }
      }

      this.logger.info('Photo URL generated', { photoId, expiry });
      return url;
    } catch (error) {
      this.logger.error('Failed to get photo URL', {
        photoId,
        expiry,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to get photo URL');
    }
  }

  async searchPhotos(query: SearchQuery): Promise<SearchResult> {
    try {
      const response = await this.retryRequest<SearchResult>(async () => {
        return await this.httpClient.post<ApiResponse<SearchResult>>(
          '/api/v1/photos/search',
          query
        );
      });

      const result = response.data.data;

      this.logger.info('Photo search performed', {
        query: query.query,
        results: result.photos.length,
        total: result.total,
        searchTime: result.searchTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to search photos', {
        query: query.query,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to search photos');
    }
  }

  async getUserPhotos(userId: string, options: PaginationOptions = {}): Promise<PhotoPage> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    try {
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());

      const response = await this.retryRequest<PhotoPage>(async () => {
        return await this.httpClient.get<ApiResponse<PhotoPage>>(
          `/api/v1/photos/user/${userId}?${params.toString()}`
        );
      });

      const result = response.data.data;

      this.logger.info('User photos retrieved', {
        userId,
        count: result.photos.length,
        total: result.pagination.total,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to get user photos', {
        userId,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to get user photos');
    }
  }

  async updatePhotoMetadata(photoId: string, metadata: Partial<PhotoMetadata>): Promise<void> {
    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    if (!metadata || Object.keys(metadata).length === 0) {
      throw new ValidationError('Metadata is required');
    }

    try {
      await this.retryRequest(async () => {
        return await this.httpClient.put(`/api/v1/photos/${photoId}/metadata`, metadata);
      });

      // Invalidate cache
      if (this.cache.isEnabled()) {
        await this.cache.delete(`photo:${photoId}`);
        // Also invalidate URL cache entries for this photo
        await this.cache.deletePattern(`url:${photoId}:*`);
      }

      this.logger.info('Photo metadata updated', {
        photoId,
        updatedFields: Object.keys(metadata),
      });
    } catch (error) {
      this.logger.error('Failed to update photo metadata', {
        photoId,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to update photo metadata');
    }
  }

  async deletePhoto(photoId: string): Promise<void> {
    if (!photoId) {
      throw new ValidationError('Photo ID is required');
    }

    try {
      await this.retryRequest(async () => {
        return await this.httpClient.delete(`/api/v1/photos/${photoId}`);
      });

      // Invalidate cache
      if (this.cache.isEnabled()) {
        await this.cache.delete(`photo:${photoId}`);
        await this.cache.deletePattern(`url:${photoId}:*`);
      }

      this.logger.info('Photo deleted', { photoId });
    } catch (error) {
      this.logger.error('Failed to delete photo', {
        photoId,
        error: (error as Error).message,
      });
      throw this.handleError(error, 'Failed to delete photo');
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.httpClient.get('/health', { timeout: 5000 });
      return response.status === 200 && response.data.success;
    } catch (error) {
      this.logger.error('Health check failed', { error: (error as Error).message });
      return false;
    }
  }

  async clearCache(): Promise<void> {
    if (this.cache.isEnabled()) {
      await this.cache.clear();
      this.logger.info('Cache cleared');
    }
  }

  getCacheStats(): { enabled: boolean; size?: number; hitRate?: number } {
    if (!this.cache.isEnabled()) {
      return { enabled: false };
    }

    return {
      enabled: true,
      size: this.cache.getSize(),
      hitRate: this.cache.getHitRate(),
    };
  }

  // === PRIVATE METHODS ===

  private validateConfig(config: StorageClientConfig): void {
    if (!config.storageServiceUrl) {
      throw new ValidationError('storageServiceUrl is required');
    }

    if (!config.minioConfig) {
      throw new ValidationError('minioConfig is required');
    }

    const requiredMinioFields = ['endPoint', 'port', 'useSSL', 'accessKey', 'secretKey'];
    for (const field of requiredMinioFields) {
      if (
        !(field in config.minioConfig) ||
        config.minioConfig[field as keyof typeof config.minioConfig] === undefined
      ) {
        throw new ValidationError(`minioConfig.${field} is required`);
      }
    }
  }

  private validateStorePhotoOptions(data: Buffer, options: StorePhotoOptions): void {
    if (!data || data.length === 0) {
      throw new ValidationError('File data cannot be empty');
    }

    const maxSize = 50 * 1024 * 1024; // 50MB
    if (data.length > maxSize) {
      throw new ValidationError(`File too large: ${data.length} > ${maxSize} bytes`);
    }

    if (!options.originalName) {
      throw new ValidationError('originalName is required');
    }

    if (!options.clientId) {
      throw new ValidationError('clientId is required');
    }

    // Validate filename
    if (!/^[\w\-. ]+$/.test(options.originalName)) {
      throw new ValidationError('Invalid characters in filename');
    }
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.httpClient.interceptors.request.use(
      config => {
        config.metadata = { startTime: Date.now() };
        return config;
      },
      error => {
        this.logger.error('Request interceptor error', { error: (error as Error).message });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.httpClient.interceptors.response.use(
      response => {
        const duration = Date.now() - (response.config.metadata?.startTime || 0);
        this.logger.info('HTTP request completed', {
          method: response.config.method?.toUpperCase(),
          url: response.config.url,
          status: response.status,
          duration,
        });
        return response;
      },
      error => {
        const duration = Date.now() - (error.config?.metadata?.startTime || 0);
        this.logger.error('HTTP request failed', {
          method: error.config?.method?.toUpperCase(),
          url: error.config?.url,
          status: error.response?.status,
          duration,
          error: (error as Error).message,
        });
        return Promise.reject(error);
      }
    );
  }

  private async retryRequest<T>(
    requestFn: () => Promise<AxiosResponse<ApiResponse<T>>>
  ): Promise<AxiosResponse<ApiResponse<T>>> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        // Don't retry on certain error types
        if (this.shouldNotRetry(error)) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay =
          this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffFactor, attempt);

        this.logger.warn(`Request failed, retrying in ${delay}ms`, {
          attempt: attempt + 1,
          maxAttempts: this.retryConfig.maxRetries + 1,
          error: (error as Error).message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private shouldNotRetry(error: any): boolean {
    // Don't retry on client errors (4xx) except 408, 429
    if (error.response?.status >= 400 && error.response?.status < 500) {
      return ![408, 429].includes(error.response.status);
    }

    // Don't retry on validation errors
    if (error instanceof ValidationError) {
      return true;
    }

    return false;
  }

  private handleError(error: any, defaultMessage: string): Error {
    if (error.response?.data?.error) {
      const apiError = error.response.data.error;

      switch (apiError.type) {
        case 'ValidationError':
          return new ValidationError(apiError.message);
        case 'PhotoNotFoundError':
          return new PhotoNotFoundError(apiError.message);
        case 'StorageConnectionError':
          return new StorageConnectionError(apiError.message);
        default:
          return new Error(apiError.message || defaultMessage);
      }
    }

    if ((error as any).code === 'ECONNREFUSED' || (error as any).code === 'ENOTFOUND') {
      return new StorageConnectionError('Unable to connect to storage service');
    }

    if ((error as any).code === 'ETIMEDOUT') {
      return new StorageConnectionError('Storage service request timed out');
    }

    return new Error((error as Error).message || defaultMessage);
  }

  private isNotFoundError(error: any): boolean {
    return (
      error.response?.status === 404 || error.response?.data?.error?.type === 'PhotoNotFoundError'
    );
  }

  private isUrlExpired(url: string): boolean {
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
