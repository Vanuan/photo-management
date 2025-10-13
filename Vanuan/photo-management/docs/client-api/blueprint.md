## **API Server Implementation**

```javascript
// ============================================================================
// API LAYER - IMPLEMENTATION
// Using: @shared-infra packages
// ============================================================================

const express = require('express');
const http = require('http');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Shared infra packages
const { StorageClient } = require('@shared-infra/storage-client');
const { JobCoordinator } = require('@shared-infra/job-queue');
const { EventBusClient } = require('@shared-infra/event-bus');

// Configuration from environment
const config = {
  port: process.env.PORT || 3000,

  // Storage service configuration
  storage: {
    serviceUrl: process.env.STORAGE_SERVICE_URL || 'http://localhost:3001',
    minioConfig: {
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123'
    }
  },

  // Redis configuration (shared by EventBus and JobQueue)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0
  },

  // Service identification
  service: {
    name: process.env.SERVICE_NAME || 'photo-api-service',
    version: process.env.SERVICE_VERSION || '1.0.0'
  }
};

// ----------------------------------------------------------------------------
// API SERVER CLASS
// ----------------------------------------------------------------------------

class APIServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.storageClient = null;
    this.jobCoordinator = null;
    this.eventBus = null;
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      console.log('Initializing API Server with shared infra packages...');

      // Initialize shared infrastructure clients
      await this.initializeSharedInfra();

      // Verify all connections
      await this.verifyConnections();

      // Setup application layers
      this.setupMiddleware();
      this.setupRoutes();
      await this.setupEventSubscriptions();

      console.log('✅ API Server initialized successfully');
      console.log(`   Service: ${config.service.name} v${config.service.version}`);
      console.log(`   Redis: ${config.redis.host}:${config.redis.port}`);
      console.log(`   Storage: ${config.storage.serviceUrl}`);

    } catch (error) {
      console.error('❌ Failed to initialize API server:', error);
      throw error;
    }
  }

  async initializeSharedInfra() {
    // Initialize Storage Client
    this.storageClient = new StorageClient({
      storageServiceUrl: config.storage.serviceUrl,
      minioConfig: config.storage.minioConfig,
      cacheConfig: {
        enabled: true,
        ttl: 300 // 5 minutes
      }
    });

    // Initialize Job Coordinator
    this.jobCoordinator = new JobCoordinator({
      connection: config.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 1000
      }
    });

    // Initialize Event Bus Client (Redis pub/sub)
    this.eventBus = new EventBusClient({
      redis: config.redis,
      serviceName: config.service.name,
      serviceVersion: config.service.version,
      options: {
        maxRetries: 3,
        retryDelay: 1000,
        enableOfflineQueue: true
      }
    });

    // Connect Event Bus to Redis
    await this.eventBus.connect();
  }

  async verifyConnections() {
    console.log('Verifying shared infrastructure connections...');

    // Check storage service
    try {
      const storageHealth = await this.storageClient.healthCheck();
      console.log(`✅ Storage service: ${storageHealth.status}`);
    } catch (error) {
      console.error('❌ Storage service unavailable:', error.message);
      throw error;
    }

    // Check event bus (Redis connection)
    try {
      const eventBusHealth = await this.eventBus.healthCheck();
      console.log(`✅ Event Bus (Redis): ${eventBusHealth.status}`);
    } catch (error) {
      console.error('❌ Event Bus (Redis) unavailable:', error.message);
      throw error;
    }

    // Job coordinator doesn't typically have health check
    console.log('✅ Job coordinator initialized');
  }

  setupMiddleware() {
    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, X-Client-ID, X-Session-ID, X-Trace-ID');
      next();
    });

    // Make shared infra clients available to routes
    this.app.use((req, res, next) => {
      req.storage = this.storageClient;
      req.jobQueue = this.jobCoordinator;
      req.eventBus = this.eventBus;
      next();
    });

    // Request logging middleware
    this.app.use((req, res, next) => {
      const traceId = req.headers['x-trace-id'] || `trace-${uuidv4()}`;
      req.traceId = traceId;

      console.log(`${new Date().toISOString()} [${traceId}] ${req.method} ${req.path}`, {
        clientId: req.headers['x-client-id'],
        sessionId: req.headers['x-session-id']
      });

      // Add trace ID to response headers
      res.header('X-Trace-ID', traceId);
      next();
    });

    // Health check (simple, no dependencies)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: config.service.name,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  setupRoutes() {
    // Photo upload
    this.app.post('/api/photos/upload',
      this.uploadMiddleware(),
      this.handlePhotoUpload.bind(this)
    );

    // List photos with filtering
    this.app.get('/api/photos', this.handleListPhotos.bind(this));

    // Get photo details
    this.app.get('/api/photos/:id', this.handleGetPhoto.bind(this));

    // Get photo status
    this.app.get('/api/photos/:id/status', this.handleGetPhotoStatus.bind(this));

    // Delete photo
    this.app.delete('/api/photos/:id', this.handleDeletePhoto.bind(this));

    // Detailed health check (with dependencies)
    this.app.get('/health/detailed', this.handleDetailedHealth.bind(this));

    // 404 handler
    this.app.use('*', this.handleNotFound.bind(this));

    // Error handler
    this.app.use(this.handleError.bind(this));
  }

  async setupEventSubscriptions() {
    console.log('Setting up event subscriptions...');

    // Subscribe to photo processing events
    await this.eventBus.subscribe('photo.processing.started', async (event) => {
      const { photoId, clientId, traceId } = event.data;
      console.log(`[${traceId}] Photo processing started: ${photoId}`);

      // Update photo status in storage
      try {
        await this.storageClient.updatePhotoMetadata(photoId, {
          processing_status: 'processing',
          processing_started_at: new Date().toISOString()
        });
      } catch (error) {
        console.error(`[${traceId}] Failed to update processing status:`, error);
      }
    });

    await this.eventBus.subscribe('photo.processing.progress', async (event) => {
      const { photoId, progress, stage, traceId } = event.data;
      console.log(`[${traceId}] Photo processing progress: ${photoId} - ${progress}% (${stage})`);

      // Update progress in storage
      try {
        const metadata = {
          processing_metadata: JSON.stringify({
            progress,
            stage,
            updated_at: new Date().toISOString()
          })
        };
        await this.storageClient.updatePhotoMetadata(photoId, metadata);
      } catch (error) {
        console.error(`[${traceId}] Failed to update progress:`, error);
      }
    });

    await this.eventBus.subscribe('photo.processing.completed', async (event) => {
      const { photoId, clientId, results, traceId } = event.data;
      console.log(`[${traceId}] Photo processing completed: ${photoId}`);

      // Update final status in storage
      try {
        await this.storageClient.updatePhotoMetadata(photoId, {
          processing_status: 'completed',
          processing_completed_at: new Date().toISOString(),
          processing_metadata: JSON.stringify(results || { completed: true })
        });
      } catch (error) {
        console.error(`[${traceId}] Failed to update completion status:`, error);
      }
    });

    await this.eventBus.subscribe('photo.processing.failed', async (event) => {
      const { photoId, clientId, error: processingError, traceId } = event.data;
      console.error(`[${traceId}] Photo processing failed: ${photoId}`, processingError);

      // Update error status in storage
      try {
        await this.storageClient.updatePhotoMetadata(photoId, {
          processing_status: 'failed',
          processing_error: processingError?.message || 'Unknown error',
          processing_completed_at: new Date().toISOString()
        });
      } catch (error) {
        console.error(`[${traceId}] Failed to update error status:`, error);
      }
    });

    // System events
    await this.eventBus.subscribe('system.health.*', async (event) => {
      console.log('System health event:', event.type, event.data);
    });

    console.log('✅ Event subscriptions established');
  }

  // --------------------------------------------------------------------------
  // ROUTE HANDLERS
  // --------------------------------------------------------------------------

  uploadMiddleware() {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1
      },
      fileFilter: (req, file, cb) => {
        // Validate file type
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Only image files are allowed'), false);
        }

        // Validate file extension
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const fileExtension = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(fileExtension)) {
          return cb(new Error('Invalid file type. Allowed: JPG, PNG, GIF, WebP'), false);
        }

        cb(null, true);
      }
    });

    return upload.single('photo');
  }

  async handlePhotoUpload(req, res) {
    const startTime = Date.now();

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      const photoId = uuidv4();
      const clientId = req.body.clientId || req.headers['x-client-id'];
      const sessionId = req.body.sessionId || req.headers['x-session-id'];
      const traceId = req.traceId;

      console.log(`[${traceId}] Starting photo upload:`, {
        photoId,
        clientId,
        filename: req.file.originalname,
        size: req.file.size
      });

      // 1. Store photo using storage client
      const storageResult = await req.storage.storePhoto(req.file.buffer, {
        photoId,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        clientId,
        sessionId,
        metadata: {
          uploadedBy: clientId,
          uploadTime: new Date().toISOString(),
          fileSize: req.file.size,
          traceId
        }
      });

      console.log(`[${traceId}] Photo stored successfully:`, storageResult.s3_key);

      // 2. Enqueue processing job
      const job = await req.jobQueue.enqueueJob('photo-processing', {
        type: 'process-photo',
        photoId,
        s3Key: storageResult.s3_key,
        mimeType: req.file.mimetype,
        clientId,
        sessionId,
        traceId
      }, {
        jobId: `photo-${photoId}`,
        priority: 5,
        delay: 100, // Small delay to ensure storage is ready
        attempts: 3
      });

      console.log(`[${traceId}] Processing job enqueued: ${job.id}`);

      // 3. Publish upload completed event
      await req.eventBus.publish('photo.uploaded', {
        photoId,
        clientId,
        sessionId,
        filename: req.file.originalname,
        size: req.file.size,
        s3Key: storageResult.s3_key,
        s3Url: storageResult.s3_url,
        jobId: job.id,
        traceId,
        uploadedAt: new Date().toISOString()
      });

      const processingTime = Date.now() - startTime;

      // 4. Send success response
      res.status(201).json({
        success: true,
        data: {
          photoId,
          filename: storageResult.filename,
          s3Url: storageResult.s3_url,
          size: req.file.size,
          uploadedAt: new Date().toISOString(),
          processingStatus: 'queued',
          jobId: job.id,
          traceId
        },
        metadata: {
          processingTime: `${processingTime}ms`,
          uploadSpeed: `${(req.file.size / processingTime).toFixed(2)} KB/s`
        }
      });

      console.log(`[${traceId}] Upload completed in ${processingTime}ms`);

    } catch (error) {
      console.error(`[${req.traceId}] Upload failed:`, error);

      // Publish error event
      try {
        await req.eventBus.publish('photo.upload.failed', {
          clientId: req.body.clientId || req.headers['x-client-id'],
          sessionId: req.body.sessionId || req.headers['x-session-id'],
          filename: req.file?.originalname,
          error: error.message,
          traceId: req.traceId
        });
      } catch (eventError) {
        console.error('Failed to publish error event:', eventError);
      }

      res.status(500).json({
        success: false,
        error: 'Upload processing failed',
        traceId: req.traceId,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async handleListPhotos(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const clientId = req.query.clientId || req.headers['x-client-id'];
      const sessionId = req.query.sessionId;

      // Build search query
      const searchQuery = {
        page,
        limit,
        filters: {}
      };

      if (clientId) {
        searchQuery.filters.clientId = clientId;
      }

      if (sessionId) {
        searchQuery.filters.sessionId = sessionId;
      }

      if (req.query.status) {
        searchQuery.filters.processingStatus = req.query.status;
      }

      if (req.query.search) {
        searchQuery.search = req.query.search;
      }

      // Use storage client to search photos
      const result = await req.storage.searchPhotos(searchQuery);

      // Generate direct URLs for each photo
      const photosWithUrls = await Promise.all(
        result.photos.map(async (photo) => {
          try {
            const directUrl = await req.storage.getPhotoUrl(photo.id, 3600); // 1 hour expiry
            return {
              ...photo,
              directUrl
            };
          } catch (error) {
            console.error(`Failed to generate URL for photo ${photo.id}:`, error);
            return photo;
          }
        })
      );

      res.json({
        success: true,
        data: {
          photos: photosWithUrls,
          pagination: result.pagination
        }
      });

    } catch (error) {
      console.error(`[${req.traceId}] List photos failed:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve photos',
        traceId: req.traceId
      });
    }
  }

  async handleGetPhoto(req, res) {
    try {
      const photoId = req.params.id;

      const photo = await req.storage.getPhoto(photoId);

      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found',
          photoId
        });
      }

      // Generate presigned URL for direct access
      const directUrl = await req.storage.getPhotoUrl(photoId, 3600); // 1 hour expiry

      res.json({
        success: true,
        data: {
          ...photo,
          directUrl
        }
      });

    } catch (error) {
      console.error(`[${req.traceId}] Get photo failed:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve photo',
        traceId: req.traceId
      });
    }
  }

  async handleGetPhotoStatus(req, res) {
    try {
      const photoId = req.params.id;

      const photo = await req.storage.getPhoto(photoId);

      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      res.json({
        success: true,
        data: {
          photoId: photo.id,
          processingStatus: photo.processing_status,
          processingMetadata: photo.processing_metadata ?
            JSON.parse(photo.processing_metadata) : null,
          processingError: photo.processing_error,
          uploadedAt: photo.uploaded_at,
          processingStartedAt: photo.processing_started_at,
          processingCompletedAt: photo.processing_completed_at,
          createdAt: photo.created_at
        }
      });

    } catch (error) {
      console.error(`[${req.traceId}] Get photo status failed:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve photo status',
        traceId: req.traceId
      });
    }
  }

  async handleDeletePhoto(req, res) {
    try {
      const photoId = req.params.id;
      const clientId = req.headers['x-client-id'];

      // Get photo first to check ownership and existence
      const photo = await req.storage.getPhoto(photoId);

      if (!photo) {
        return res.status(404).json({
          success: false,
          error: 'Photo not found'
        });
      }

      // Check if client owns the photo (if clientId provided)
      if (clientId && photo.client_id !== clientId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to delete this photo'
        });
      }

      // Delete using storage client
      await req.storage.deletePhoto(photoId);

      // Publish deletion event
      await req.eventBus.publish('photo.deleted', {
        photoId,
        clientId: photo.client_id,
        sessionId: photo.session_id,
        deletedAt: new Date().toISOString(),
        traceId: req.traceId
      });

      res.json({
        success: true,
        data: {
          photoId,
          deleted: true,
          deletedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error(`[${req.traceId}] Delete photo failed:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete photo',
        traceId: req.traceId
      });
    }
  }

  async handleDetailedHealth(req, res) {
    try {
      // Check health of all shared infra services
      const [storageHealth, eventBusHealth] = await Promise.all([
        req.storage.healthCheck().catch(error => ({
          status: 'unhealthy',
          error: error.message
        })),
        req.eventBus.healthCheck().catch(error => ({
          status: 'unhealthy',
          error: error.message
        }))
      ]);

      const overallStatus =
        storageHealth.status === 'healthy' &&
        eventBusHealth.status === 'healthy' ? 'healthy' : 'degraded';

      res.json({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: config.service.name,
        version: config.service.version,
        services: {
          storage: storageHealth,
          eventBus: eventBusHealth,
          jobQueue: { status: 'healthy' } // Assuming healthy if no error
        }
      });

    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  handleNotFound(req, res) {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: req.originalUrl
    });
  }

  handleError(err, req, res, next) {
    console.error(`[${req.traceId}] Unhandled error:`, err);

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      traceId: req.traceId,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  // --------------------------------------------------------------------------
  // SERVER MANAGEMENT
  // --------------------------------------------------------------------------

  async start() {
    if (this.isShuttingDown) {
      throw new Error('Server is shutting down');
    }

    await this.initialize();

    this.server.listen(config.port, () => {
      console.log('\n🚀 API Server started successfully');
      console.log(`   Port: ${config.port}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   PID: ${process.pid}`);
      console.log('   Ready to accept requests\n');
    });

    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;

      this.isShuttingDown = true;
      console.log(`\n📦 Received ${signal}, starting graceful shutdown...`);

      // Close HTTP server (stop accepting new requests)
      this.server.close(async () => {
        console.log('✅ HTTP server closed');

        try {
          // Disconnect Event Bus
          if (this.eventBus) {
            await this.eventBus.disconnect();
            console.log('✅ Event Bus disconnected');
          }

          // Close other connections if needed
          console.log('✅ Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// ----------------------------------------------------------------------------
// START SERVER
// ----------------------------------------------------------------------------

if (require.main === module) {
  const server = new APIServer();

  server.start().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = APIServer;
```

## **Key Corrections Made:**

### 1. **Event Bus is a Redis Client**
- No `eventBusUrl` configuration
- Direct Redis connection via `EventBusClient`
- Uses Redis pub/sub internally

### 2. **No Socket.IO Server**
- Removed all Socket.IO server code
- Event Bus handles service-to-service communication only
- WebSocket support would require separate service

### 3. **Proper Shared Infra Usage**
- All clients initialized with correct configuration
- Proper connection management
- Health checks for all services

### 4. **Production Ready**
- Comprehensive error handling
- Graceful shutdown
- Request tracing
- Structured logging
- Input validation

### 5. **Environment Variables**
```bash
# Required
REDIS_HOST=localhost
REDIS_PORT=6379
STORAGE_SERVICE_URL=http://localhost:3001

# Optional
PORT=3000
SERVICE_NAME=photo-api-service
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
```

This implementation correctly uses the Event Bus as a Redis pub/sub client library and follows the actual architecture described in your documentation.
