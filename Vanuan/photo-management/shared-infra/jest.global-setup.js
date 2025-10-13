// Global Jest setup for the entire workspace

const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  console.log('🧪 Setting up Jest global test environment...');

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.SUPPRESS_WARNINGS = 'true';

  // Database and storage configuration for tests
  process.env.SQLITE_DB_PATH = ':memory:';
  process.env.MINIO_ENDPOINT = 'localhost';
  process.env.MINIO_PORT = '9000';
  process.env.MINIO_ACCESS_KEY = 'minioadmin';
  process.env.MINIO_SECRET_KEY = 'minioadmin';
  process.env.MINIO_USE_SSL = 'false';

  // Service configuration
  process.env.STORAGE_SERVICE_URL = 'http://localhost:3001';
  process.env.STORAGE_SERVICE_PORT = '3001';

  // Cache configuration
  process.env.CACHE_ENABLED = 'false';
  process.env.CACHE_TTL = '300';
  process.env.CACHE_MAX_SIZE = '1000';

  // Performance settings
  process.env.MAX_WORKERS = '1';
  process.env.BATCH_SIZE = '10';
  process.env.CONNECTION_POOL_SIZE = '5';

  // Security settings
  process.env.JWT_SECRET = 'test-jwt-secret-key';
  process.env.API_KEY = 'test-api-key';

  // Timeout settings
  process.env.REQUEST_TIMEOUT = '30000';
  process.env.DB_TIMEOUT = '10000';
  process.env.STORAGE_TIMEOUT = '30000';

  // File size limits
  process.env.MAX_FILE_SIZE = '52428800'; // 50MB
  process.env.MAX_UPLOAD_SIZE = '52428800';

  // Feature flags for testing
  process.env.ENABLE_METRICS = 'false';
  process.env.ENABLE_TRACING = 'false';
  process.env.ENABLE_HEALTH_CHECKS = 'true';
  process.env.ENABLE_REQUEST_LOGGING = 'false';

  // Retry configuration
  process.env.MAX_RETRIES = '3';
  process.env.RETRY_DELAY = '1000';
  process.env.BACKOFF_FACTOR = '2';

  // Validation settings
  process.env.STRICT_VALIDATION = 'true';
  process.env.VALIDATE_FILE_TYPES = 'true';
  process.env.ALLOWED_FILE_TYPES = 'image/jpeg,image/png,image/gif,image/webp,video/mp4';

  // Cleanup settings
  process.env.CLEANUP_TEMP_FILES = 'true';
  process.env.CLEANUP_EXPIRED_URLS = 'true';

  // Development settings
  process.env.DEBUG_MODE = 'false';
  process.env.VERBOSE_LOGGING = 'false';

  try {
    // Ensure test directories exist
    const testDirs = ['test-results', 'coverage', '.jest-cache'];

    for (const dir of testDirs) {
      const fullPath = path.join(__dirname, dir);
      try {
        execSync(`mkdir -p ${fullPath}`, { stdio: 'ignore' });
      } catch (error) {
        // Directory might already exist, ignore error
      }
    }

    // Clean up any existing test artifacts
    try {
      execSync('rm -rf test-results/* coverage/* .jest-cache/*', {
        cwd: __dirname,
        stdio: 'ignore',
      });
    } catch (error) {
      // Ignore cleanup errors
    }

    console.log('✅ Jest global setup completed successfully');
  } catch (error) {
    console.error('❌ Jest global setup failed:', error.message);
    throw error;
  }

  // Global test timeout is configured in individual jest configs

  // Global setup for better error handling
  process.on('uncaughtException', error => {
    console.error('Uncaught Exception in Jest global setup:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection in Jest global setup at:', promise, 'reason:', reason);
    process.exit(1);
  });

  // Set up test database isolation
  global.TEST_ISOLATION = {
    dbConnections: new Map(),
    tempFiles: new Set(),
    mockServers: new Map(),
  };

  // Helper functions for test isolation
  global.testHelpers = {
    generateTestId: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,

    createIsolatedDbPath: () => {
      const testId = global.testHelpers.generateTestId();
      return `:memory:${testId}`;
    },

    trackTempFile: filePath => {
      global.TEST_ISOLATION.tempFiles.add(filePath);
    },

    cleanupTempFiles: () => {
      for (const filePath of global.TEST_ISOLATION.tempFiles) {
        try {
          execSync(`rm -f ${filePath}`, { stdio: 'ignore' });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      global.TEST_ISOLATION.tempFiles.clear();
    },
  };

  console.log('🎯 Jest environment ready for testing');
};
