export { StorageClient } from './client';
export { CacheManager, createCacheManager } from './cache';
export { Logger, createLogger, logger } from './logger';

// Export types and interfaces from client
export type { StorageClientConfig, ApiResponse } from './client';

// Export cache types
export type { CacheConfig, CacheEntry } from './cache';

// Export logger types
export type { LogLevel, LogLevelName, LogEntry } from './logger';

// Re-export types from storage-core for convenience
export type {
  StorePhotoOptions,
  PhotoResult,
  Photo,
  SearchQuery,
  SearchResult,
  PaginationOptions,
  PhotoPage,
  PhotoMetadata,
  ProcessingStatus,
  MinioConfig,
} from '@shared-infra/storage-core';

// Re-export error classes
export {
  StorageError,
  ValidationError,
  PhotoNotFoundError,
  DatabaseError,
  StorageConnectionError,
} from '@shared-infra/storage-core';

// Version information
export const VERSION = '1.0.0';

// Default configurations
export const DEFAULT_CLIENT_CONFIG = {
  timeout: 30000,
  retryConfig: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffFactor: 2,
  },
  cacheConfig: {
    enabled: true,
    ttl: 300,
    maxSize: 1000,
  },
};

// Utility functions for client usage
export const utils = {
  createStorageClient: (config: any) => {
    const { StorageClient } = require('./client');
    return new StorageClient(config);
  },
  isValidUrl: (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  formatBytes: (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },
};
