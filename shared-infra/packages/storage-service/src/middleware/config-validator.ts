import { StorageServiceConfig } from '../server';
import { ValidationError } from '@shared-infra/storage-core';

export function validateConfig(config: StorageServiceConfig): void {
  const errors: string[] = [];

  // Validate server configuration
  if (!config.server) {
    errors.push('server configuration is required');
  } else {
    if (!config.server.port || typeof config.server.port !== 'number') {
      errors.push('server.port must be a valid number');
    }

    if (config.server.port < 1 || config.server.port > 65535) {
      errors.push('server.port must be between 1 and 65535');
    }

    if (!config.server.host || typeof config.server.host !== 'string') {
      errors.push('server.host must be a valid string');
    }
  }

  // Validate database configuration
  if (!config.database) {
    errors.push('database configuration is required');
  } else {
    if (!config.database.path || typeof config.database.path !== 'string') {
      errors.push('database.path must be a valid string');
    }

    if (config.database.backupInterval && typeof config.database.backupInterval !== 'number') {
      errors.push('database.backupInterval must be a number if provided');
    }

    if (config.database.backupInterval && config.database.backupInterval < 60) {
      errors.push('database.backupInterval must be at least 60 seconds');
    }
  }

  // Validate MinIO configuration
  if (!config.minio) {
    errors.push('minio configuration is required');
  } else {
    if (!config.minio.endPoint || typeof config.minio.endPoint !== 'string') {
      errors.push('minio.endPoint must be a valid string');
    }

    if (!config.minio.port || typeof config.minio.port !== 'number') {
      errors.push('minio.port must be a valid number');
    }

    if (config.minio.port < 1 || config.minio.port > 65535) {
      errors.push('minio.port must be between 1 and 65535');
    }

    if (typeof config.minio.useSSL !== 'boolean') {
      errors.push('minio.useSSL must be a boolean');
    }

    if (!config.minio.accessKey || typeof config.minio.accessKey !== 'string') {
      errors.push('minio.accessKey must be a valid string');
    }

    if (!config.minio.secretKey || typeof config.minio.secretKey !== 'string') {
      errors.push('minio.secretKey must be a valid string');
    }

    if (config.minio.region && typeof config.minio.region !== 'string') {
      errors.push('minio.region must be a string if provided');
    }

    // Validate credentials are not default values in production
    if (process.env.NODE_ENV === 'production') {
      if (config.minio.accessKey === 'minioadmin') {
        errors.push('minio.accessKey should not use default value in production');
      }

      if (config.minio.secretKey === 'minioadmin') {
        errors.push('minio.secretKey should not use default value in production');
      }
    }
  }

  // Validate cache configuration (optional)
  if (config.cache) {
    if (typeof config.cache.enabled !== 'boolean') {
      errors.push('cache.enabled must be a boolean');
    }

    if (typeof config.cache.ttl !== 'number' || config.cache.ttl < 1) {
      errors.push('cache.ttl must be a positive number');
    }

    if (config.cache.ttl > 86400) {
      errors.push('cache.ttl should not exceed 86400 seconds (24 hours)');
    }

    if (typeof config.cache.maxSize !== 'number' || config.cache.maxSize < 1) {
      errors.push('cache.maxSize must be a positive number');
    }
  }

  // Validate performance configuration (optional)
  if (config.performance) {
    if (typeof config.performance.batchSize !== 'number' || config.performance.batchSize < 1) {
      errors.push('performance.batchSize must be a positive number');
    }

    if (config.performance.batchSize > 1000) {
      errors.push('performance.batchSize should not exceed 1000');
    }

    if (
      typeof config.performance.connectionPoolSize !== 'number' ||
      config.performance.connectionPoolSize < 1
    ) {
      errors.push('performance.connectionPoolSize must be a positive number');
    }

    if (config.performance.connectionPoolSize > 100) {
      errors.push('performance.connectionPoolSize should not exceed 100');
    }
  }

  // Environment-specific validations
  if (process.env.NODE_ENV === 'production') {
    validateProductionConfig(config, errors);
  }

  if (errors.length > 0) {
    throw new ValidationError(`Configuration validation failed: ${errors.join(', ')}`);
  }
}

function validateProductionConfig(config: StorageServiceConfig, errors: string[]): void {
  // Production-specific validations
  if (config.server.host === '0.0.0.0') {
    console.warn('WARNING: Server is binding to all interfaces (0.0.0.0) in production');
  }

  // Check for secure defaults
  if (
    config.minio.useSSL === false &&
    config.minio.endPoint !== 'localhost' &&
    config.minio.endPoint !== '127.0.0.1'
  ) {
    console.warn('WARNING: MinIO is configured without SSL in production');
  }

  // Validate database path is not in tmp directory
  if (config.database.path.startsWith('/tmp/') || config.database.path.startsWith('./tmp/')) {
    errors.push('database.path should not be in temporary directory in production');
  }

  // Check cache is enabled in production
  if (config.cache && config.cache.enabled === false) {
    console.warn('WARNING: Cache is disabled in production');
  }
}

export function validateEnvironmentVariables(): void {
  const required = ['MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'SQLITE_PATH'];

  const missing = required.filter(envVar => !process.env[envVar]);

  if (missing.length > 0) {
    throw new ValidationError(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function sanitizeConfig(config: StorageServiceConfig): StorageServiceConfig {
  // Create a deep copy to avoid mutating the original
  const sanitized = JSON.parse(JSON.stringify(config));

  // Sanitize sensitive information for logging
  if (sanitized.minio.accessKey) {
    sanitized.minio.accessKey = '***';
  }

  if (sanitized.minio.secretKey) {
    sanitized.minio.secretKey = '***';
  }

  return sanitized;
}

export function getConfigSummary(config: StorageServiceConfig): Record<string, any> {
  return {
    server: {
      port: config.server.port,
      host: config.server.host,
    },
    database: {
      path: config.database.path,
      backupEnabled: !!config.database.backupInterval,
    },
    minio: {
      endPoint: config.minio.endPoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      region: config.minio.region || 'us-east-1',
    },
    cache: config.cache
      ? {
          enabled: config.cache.enabled,
          ttl: config.cache.ttl,
          maxSize: config.cache.maxSize,
        }
      : { enabled: false },
    performance: config.performance
      ? {
          batchSize: config.performance.batchSize,
          connectionPoolSize: config.performance.connectionPoolSize,
        }
      : { default: true },
  };
}
