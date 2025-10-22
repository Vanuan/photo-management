export { StorageCoordinator } from './coordinator';
export { MinIOClient } from './minio-client';
export { SQLiteClient, Logger, SQLiteTransaction } from './sqlite-client';

// Export all types and interfaces
export * from './types';

// Re-export commonly used types for convenience
export type {
  StorageCoordinatorConfig,
  MinioConfig,
  StorePhotoOptions,
  PhotoResult,
  Photo,
  SearchQuery,
  SearchResult,
  PaginationOptions,
  PhotoPage,
  PhotoMetadata,
  ProcessingStatus,
  HealthStatus,
} from './types';

// Export error classes
export {
  StorageError,
  ValidationError,
  PhotoNotFoundError,
  DatabaseError,
  StorageConnectionError,
} from './types';

// Version information
export const VERSION = '1.0.0';

// Default configurations
export const DEFAULT_CONFIG = {
  cache: {
    enabled: true,
    ttl: 300,
    maxSize: 1000,
  },
  performance: {
    batchSize: 10,
    connectionPoolSize: 5,
    maxRetries: 3,
    retryDelay: 1000,
  },
  consistency: {
    runOnStartup: false,
    scheduleInterval: 3600,
    orphanCleanup: true,
  },
};

// Utility functions
export const utils = {
  generatePhotoId: () => require('crypto').randomUUID(),
  calculateChecksum: (data: Buffer) =>
    require('crypto').createHash('sha256').update(data).digest('hex'),
  sanitizeFilename: (filename: string) => filename.replace(/[^a-zA-Z0-9.-]/g, '_'),
  isValidContentType: (contentType: string) => {
    const allowed = [
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
    return allowed.includes(contentType);
  },
};
