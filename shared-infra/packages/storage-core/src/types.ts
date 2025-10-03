export interface StorageCoordinatorConfig {
  sqlitePath: string;
  minioConfig: MinioConfig;
  cacheConfig?: CacheConfig;
  performanceConfig?: PerformanceConfig;
  consistency?: ConsistencyConfig;
}

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  maxSize: number; // Maximum number of cached items
}

export interface PerformanceConfig {
  batchSize: number;
  connectionPoolSize: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface ConsistencyConfig {
  runOnStartup: boolean;
  scheduleInterval?: number; // Consistency check interval in seconds
  orphanCleanup?: boolean;
}

export interface StorePhotoOptions {
  originalName: string;
  contentType?: string;
  clientId: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, string>;
}

export interface PhotoResult {
  id: string;
  s3_key: string;
  s3_url: string;
  bucket: string;
  size: number;
  checksum?: string;
  processing_status: ProcessingStatus;
  created_at: string;
}

export interface Photo extends PhotoResult {
  original_filename: string;
  mime_type: string;
  width?: number;
  height?: number;
  duration?: number; // for videos
  client_id: string;
  session_id?: string;
  user_id?: string;
  processing_metadata?: string; // JSON blob
  processing_error?: string;
  uploaded_at: string;
  processing_started_at?: string;
  processing_completed_at?: string;
  updated_at: string;
}

export type ProcessingStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface PhotoMetadata {
  width?: number;
  height?: number;
  duration?: number;
  processing_status?: ProcessingStatus;
  processing_metadata?: string;
  processing_error?: string;
  processing_started_at?: string;
  processing_completed_at?: string;
}

export interface SearchQuery {
  query?: string; // Text search query
  filters?: SearchFilters;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}

export interface SearchFilters {
  client_id?: string;
  user_id?: string;
  mime_type?: string[];
  processing_status?: ProcessingStatus[];
  date_range?: {
    start: string;
    end: string;
  };
  size_range?: {
    min: number;
    max: number;
  };
}

export interface SortOption {
  field: 'uploaded_at' | 'created_at' | 'file_size' | 'original_filename';
  order: 'asc' | 'desc';
}

export interface SearchResult {
  photos: Photo[];
  total: number;
  page: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  searchTime: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface PhotoPage {
  photos: Photo[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface HealthStatus {
  service: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  storage: 'connected' | 'disconnected';
  timestamp: string;
  uptime: number;
  version: string;
}

// Error classes
export class StorageError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class ValidationError extends StorageError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class PhotoNotFoundError extends StorageError {
  constructor(message: string) {
    super(message, 'PHOTO_NOT_FOUND');
    this.name = 'PhotoNotFoundError';
  }
}

export class DatabaseError extends StorageError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class StorageConnectionError extends StorageError {
  constructor(message: string) {
    super(message, 'STORAGE_CONNECTION_ERROR');
    this.name = 'StorageConnectionError';
  }
}

// Internal types for database operations
export interface DatabaseRecord {
  [key: string]: any;
}

export interface TransactionContext {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface MinIOObjectInfo {
  bucket: string;
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface PutObjectOptions {
  contentType: string;
  metadata?: Record<string, string>;
}
