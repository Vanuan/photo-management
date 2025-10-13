import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { StorageCoordinator, StorageCoordinatorConfig, Logger } from '@shared-infra/storage-core';
import { PhotoRoutes } from './routes/photos';
import { HealthRoutes } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { validateConfig } from './middleware/config-validator';

export interface StorageServiceConfig {
  server: {
    port: number;
    host: string;
  };
  database: {
    path: string;
    backupInterval?: number;
  };
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    region?: string;
  };
  cache?: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  performance?: {
    batchSize: number;
    connectionPoolSize: number;
  };
}

export class StorageService {
  public app: Application;
  private server: any;
  private storage!: StorageCoordinator;
  private logger: Logger;
  private startTime: Date;

  constructor(private config: StorageServiceConfig) {
    this.logger = new Logger('StorageService');
    this.startTime = new Date();
    this.app = express();
    this.setupMiddleware();
    this.setupStorage();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // CORS configuration
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
        credentials: true,
      })
    );

    // Request parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Request logging
    this.app.use(requestLogger(this.logger));

    // Add request ID for tracing
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      req.id = require('crypto').randomUUID();
      res.setHeader('X-Request-ID', req.id || '');
      next();
    });
  }

  private setupStorage(): void {
    const storageConfig: StorageCoordinatorConfig = {
      sqlitePath: this.config.database.path,
      minioConfig: this.config.minio,
      cacheConfig: this.config.cache,
      performanceConfig: this.config.performance,
    };

    this.storage = new StorageCoordinator(storageConfig);
  }

  private setupRoutes(): void {
    // Health check route (before other middleware)
    const healthRoutes = new HealthRoutes(this.storage, this.logger, this.startTime);
    this.app.use('/health', healthRoutes.router);

    // API versioning
    const apiV1 = express.Router();

    // Photo routes
    const photoRoutes = new PhotoRoutes(this.storage, this.logger);
    apiV1.use('/photos', photoRoutes.router);

    // Mount API routes
    this.app.use('/api/v1', apiV1);

    // Root route
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        service: 'Storage Service',
        version: '1.0.0',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          api: '/api/v1',
          photos: '/api/v1/photos',
        },
      });
    });

    // 404 handler for unknown routes
    this.app.use('*', (req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler(this.logger));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack,
      });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.logger.error('Unhandled Rejection', {
        reason: reason?.message || reason,
        promise: promise.toString(),
      });
      process.exit(1);
    });
  }

  async start(): Promise<void> {
    try {
      // Validate configuration
      validateConfig(this.config);

      // Initialize storage coordinator
      await this.storage.initialize();

      // Start HTTP server
      return new Promise((resolve, reject) => {
        this.server = this.app.listen(this.config.server.port, this.config.server.host, () => {
          this.logger.info('Storage Service started successfully', {
            port: this.config.server.port,
            host: this.config.server.host,
            pid: process.pid,
            nodeVersion: process.version,
          });
          resolve();
        });

        this.server.on('error', (error: Error) => {
          this.logger.error('Server failed to start', { error: error.message });
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error('Failed to start Storage Service', {
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down Storage Service...');

      // Close HTTP server
      if (this.server) {
        await new Promise<void>(resolve => {
          this.server.close(() => {
            this.logger.info('HTTP server closed');
            resolve();
          });
        });
      }

      // Close storage connections
      await this.storage.close();

      this.logger.info('Storage Service shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown', {
        error: (error as Error).message,
      });
    }
  }

  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }
}

// Service configuration interface extension for Express
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// Service entry point
if (require.main === module) {
  const config: StorageServiceConfig = {
    server: {
      port: parseInt(process.env.PORT || '3001'),
      host: process.env.HOST || '0.0.0.0',
    },
    database: {
      path: process.env.SQLITE_PATH || './data/storage.db',
      backupInterval: parseInt(process.env.BACKUP_INTERVAL || '3600'),
    },
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      region: process.env.MINIO_REGION || 'us-east-1',
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      ttl: parseInt(process.env.CACHE_TTL || '300'),
      maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000'),
    },
    performance: {
      batchSize: parseInt(process.env.BATCH_SIZE || '10'),
      connectionPoolSize: parseInt(process.env.DB_POOL_SIZE || '5'),
    },
  };

  const service = new StorageService(config);

  // Graceful shutdown handlers
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, starting graceful shutdown...');
    await service.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, starting graceful shutdown...');
    await service.shutdown();
    process.exit(0);
  });

  // Start service
  service.start().catch(error => {
    console.error('Failed to start service:', error);
    process.exit(1);
  });
}
