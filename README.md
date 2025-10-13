# Photo Management System - Broker-Centric Architecture

## 🎯 Architectural Philosophy

This system follows a **message broker-centric design** where **BullMQ (Redis)** serves as the central coordination point between two independent subsystems:

1. **Client + API Subsystem** - Handles uploads, sessions, and client interactions
2. **Processing Subsystem** - Executes async photo processing pipelines

The two subsystems **never communicate directly**. They only interact through:
- **BullMQ** for job coordination
- **Shared Storage** (MinIO + SQLite) for data exchange
- **Event Bus** for real-time client notifications

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLIENT + API SUBSYSTEM                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📱 Web/Mobile Clients                                              │
│         ↕ HTTPS/WebSocket                                           │
│  🌐 API Gateway                                                     │
│     ├─ Upload Endpoints                                             │
│     ├─ Session Management                                           │
│     └─ Authentication/Validation                                    │
│         │                                                           │
│         ├──▶ 💾 MinIO (Store Blob)                                 │
│         ├──▶ 🗄️ SQLite (Create Metadata Record)                    │
│         └──▶ 📨 BullMQ (Enqueue Job Metadata)                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE LAYER                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📨 BullMQ (Redis)                  💾 Storage Layer                │
│     ├─ Job Queues                      ├─ MinIO (Blobs)            │
│     ├─ Priority Management             ├─ SQLite (Metadata)         │
│     ├─ Retry Policies                  └─ Consistency Manager      │
│     └─ Dead Letter Queue                                           │
│                                                                     │
│  🔔 Event Bus                                                       │
│     ├─ Redis Pub/Sub                                               │
│     ├─ WebSocket Bridge                                            │
│     └─ Client Room Management                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                      PROCESSING SUBSYSTEM                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ⚡ Worker Pool                                                     │
│     ├─ Job Consumer (BullMQ)                                       │
│     ├─ Pipeline Orchestrator                                       │
│     └─ Processor Registry                                          │
│         │                                                           │
│         ├──▶ 💾 MinIO (Fetch Blob)                                 │
│         ├──▶ 🔧 Process (Thumbnails, Validation, etc)              │
│         ├──▶ 💾 MinIO (Store Results)                              │
│         ├──▶ 🗄️ SQLite (Update Metadata)                           │
│         └──▶ 📨 BullMQ (Publish Completion Event)                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🐳 Docker Setup

The photo management system is fully containerized and can be deployed using Docker Compose. This setup includes all necessary infrastructure services and application components.

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available
- 10GB free disk space

### Quick Start (Development)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd photo-management
   ```

2. **Copy environment configuration:**
   ```bash
   cp .env.example .env
   # Edit .env if needed for custom configuration
   ```

3. **Start all services:**
   ```bash
   docker-compose up -d
   ```

4. **Initialize MinIO buckets (one-time setup):**
   ```bash
   docker-compose --profile setup up mc
   ```

5. **Access the application:**
   - Frontend: http://localhost:5173
   - API Gateway: http://localhost:3000
   - MinIO Console: http://localhost:9001 (admin/minioadmin)

### Production Deployment

For production deployments, the system uses an Nginx reverse proxy as a single entry point:

1. **Build and start production services:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

2. **Initialize MinIO buckets (one-time setup):**
   ```bash
   docker-compose --profile setup up mc
   ```

3. **Access the application:**
   - Application: http://localhost (all services unified through Nginx)
   - Health check: http://localhost/health

**Production Features:**
- ✅ Nginx reverse proxy as single entry point
- ✅ Frontend served as static files (no separate container)
- ✅ API proxying through `/api` prefix
- ✅ WebSocket proxying through `/socket.io`
- ✅ Security headers (CSP, HSTS, X-Frame-Options)
- ✅ Rate limiting (100 req/s API, 10 req/s uploads)
- ✅ Gzip compression
- ✅ CORS configuration
- ✅ Internal services hidden from external access
- ✅ 5 worker replicas for increased processing capacity

**HTTPS/SSL Setup:**

For production with HTTPS, see [nginx/README.md](nginx/README.md) for detailed instructions on:
- Obtaining Let's Encrypt certificates
- Configuring SSL/TLS
- HTTPS redirect and HSTS
- WebSocket over WSS

### Service Architecture

**Development Mode:**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │  API Gateway    │    │     Worker      │
│   (React)       │◄──►│  (Node.js)      │    │   (Node.js)     │
│   :5173         │    │   :3000         │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │ Infrastructure  │
                    │   Services      │
                    ├─────────────────┤
                    │ Redis :6379     │
                    │ MinIO :9000/1   │
                    │ Storage :3001   │
                    └─────────────────┘
```

**Production Mode (with Nginx):**
```
                    ┌─────────────────┐
                    │   Nginx :80     │
                    │ Reverse Proxy   │
                    │  (+ Frontend)   │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
         ┌──────────▼─────┐    ┌─────▼──────────┐
         │  API Gateway   │    │    Worker×5    │
         │   (internal)   │    │   (internal)   │
         └────────┬───────┘    └────────┬───────┘
                  │                     │
                  └──────────┬──────────┘
                             │
                ┌────────────▼────────────┐
                │  Infrastructure Services │
                │  (Redis, MinIO, SQLite) │
                │      (internal)         │
                └─────────────────────────┘
```

### Services

**Development Mode:**
- **Frontend** (`frontend:5173`): React development server
- **API Gateway** (`api-gateway:3000`): REST API and WebSocket server
- **Worker** (`worker`): Photo processing pipeline (3 replicas)
- **Redis** (`redis:6379`): Job queue and event bus backend
- **MinIO** (`minio:9000/9001`): Object storage for photos and thumbnails
- **Storage Service** (`storage-service:3001`): Metadata and database operations

**Production Mode:**
- **Nginx** (`nginx:80/443`): Reverse proxy + static frontend hosting
- **API Gateway** (internal): REST API and WebSocket server
- **Worker** (internal): Photo processing pipeline (5 replicas)
- **Redis** (internal): Job queue and event bus backend
- **MinIO** (`minio:9000`): Object storage (console hidden)
- **Storage Service** (internal): Metadata and database operations

### Development Commands

```bash
# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f api-gateway

# Stop all services
docker-compose down

# Rebuild and restart a service
docker-compose up -d --build api-gateway

# Scale workers
docker-compose up -d --scale worker=5

# Clean up (removes volumes)
docker-compose down -v
```

### Production Commands

```bash
# Start production stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# View logs (production)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Rebuild nginx after config changes
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build nginx
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx

# Stop production stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml down

# Scale workers (production has 5 by default)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale worker=10

# Check nginx config syntax
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -t

# Reload nginx config without downtime
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload

# View nginx access logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx tail -f /var/log/nginx/access.log

# View nginx error logs
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx tail -f /var/log/nginx/error.log
```

### Health Checks

All services include health checks. Use these endpoints to verify service status:

- API Gateway: `GET /health`
- Storage Service: `GET /health`
- Redis: `redis-cli ping` (inside container)
- MinIO: `GET /minio/health/live`

### Volumes

Persistent data is stored in named volumes:
- `redis_data`: Redis persistence
- `minio_data`: MinIO object storage
- `sqlite_data`: SQLite database

### Environment Configuration

Key environment variables (see `.env.example`):

```bash
# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# MinIO
MINIO_ENDPOINT=minio
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# API Gateway
PORT=3000
STORAGE_SERVICE_URL=http://storage-service:3001

# Worker
THUMBNAIL_SIZES=150,300,600
OPTIMIZATION_QUALITY=80
```

### Troubleshooting

**Common Issues (Development):**

1. **Port conflicts**: Ensure ports 3000, 3001, 5173, 6379, 9000, 9001 are available

2. **MinIO bucket creation fails**:
   ```bash
   docker-compose --profile setup up mc
   ```

3. **Worker not processing jobs**: Check Redis connectivity
   ```bash
   docker-compose exec redis redis-cli ping
   ```

4. **Frontend WebSocket connection fails**: Verify API Gateway is healthy
   ```bash
   curl http://localhost:3000/health
   ```

**Common Issues (Production):**

1. **Nginx fails to start**: Check configuration syntax
   ```bash
   docker run --rm -v $(pwd)/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.25-alpine nginx -t
   ```

2. **API requests return 502 Bad Gateway**: Verify api-gateway is running
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps api-gateway
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs api-gateway
   ```

3. **WebSocket connections fail**: Check Socket.IO endpoint
   ```bash
   curl -i http://localhost/socket.io/
   # Should return 400 with "Session ID unknown" (Socket.IO is working)
   ```

4. **Rate limiting too strict**: Adjust limits in nginx/nginx.conf:
   ```nginx
   limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
   ```

5. **CORS errors**: Verify origin in nginx configuration matches your domain

**Debug Mode:**
```bash
# Run with debug logging (development)
docker-compose up

# Run production stack in foreground
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up

# Check container resource usage
docker stats

# Inspect container logs
docker-compose logs worker

# Check nginx configuration
docker-compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx cat /etc/nginx/conf.d/default.conf
```

---

## 🔄 Data Flow: Photo Upload to Processing

### Sequence Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API Gateway
    participant M as MinIO
    participant D as SQLite
    participant Q as BullMQ
    participant E as Event Bus
    participant W as Worker
    
    Note over C,W: 1. Upload Phase (Client + API Subsystem)
    C->>A: POST /photos/upload
    A->>A: Validate request
    A->>M: Store blob → s3Key
    A->>D: Create metadata record
    A->>Q: Enqueue job metadata
    A->>E: Publish upload.started
    A->>C: 201 Created + photoId
    E->>C: WebSocket: upload.completed
    
    Note over C,W: 2. Processing Phase (Processing Subsystem)
    Q->>W: Dequeue job
    W->>M: Fetch blob by s3Key
    W->>W: Execute pipeline stages
    W->>M: Store thumbnails
    W->>D: Update processing_metadata
    W->>Q: Publish completion event
    W->>E: Notify Event Bus
    E->>C: WebSocket: processing.completed
```

---

## 📨 BullMQ Job Structure

### Job Metadata Schema

```typescript
// Job enqueued by API Gateway
interface PhotoProcessingJob {
  // Job Identification
  id: string;                    // Job ID (generated by BullMQ)
  photoId: string;               // Photo UUID (database primary key)
  
  // Storage References
  storage: {
    s3Key: string;               // MinIO object key
    bucket: string;              // MinIO bucket name
    originalSize: number;        // File size in bytes
    mimeType: string;            // image/jpeg, etc
  };
  
  // Processing Configuration
  pipeline: {
    name: string;                // 'full_processing' | 'quick_processing'
    stages: string[];            // ['validation', 'thumbnails', 'metadata']
    priority: number;            // 1-10
  };
  
  // Context Metadata
  context: {
    clientId: string;            // Client identifier
    sessionId?: string;          // Upload session
    uploadedAt: string;          // ISO timestamp
    traceId: string;             // Distributed tracing ID
  };
  
  // BullMQ Options
  opts: {
    attempts: 3;                 // Retry count
    backoff: {
      type: 'exponential';
      delay: 5000;               // Initial delay in ms
    };
    removeOnComplete: true;      // Cleanup after success
    removeOnFail: false;         // Keep failed jobs for debugging
  };
}
```

### Job Queue Configuration

```typescript
// API Gateway - Job Producer
class JobProducer {
  private queue: Queue;
  
  constructor() {
    this.queue = new Queue('photo-processing', {
      connection: {
        host: 'redis',
        port: 6379
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,      // Keep last 100 completed
        removeOnFail: 1000          // Keep last 1000 failed
      }
    });
  }
  
  async enqueuePhotoProcessing(
    photoId: string,
    storageInfo: StorageInfo,
    pipelineConfig: PipelineConfig
  ): Promise<string> {
    
    const job = await this.queue.add(
      'process-photo',              // Job name
      {
        photoId,
        storage: storageInfo,
        pipeline: pipelineConfig,
        context: {
          clientId: req.clientId,
          sessionId: req.sessionId,
          uploadedAt: new Date().toISOString(),
          traceId: req.traceId
        }
      },
      {
        priority: pipelineConfig.priority || 5,
        jobId: `photo:${photoId}`,  // Prevent duplicate jobs
      }
    );
    
    logger.info(`Enqueued processing job for photo ${photoId}`, {
      jobId: job.id,
      queue: 'photo-processing'
    });
    
    return job.id;
  }
}

// Worker - Job Consumer
class JobConsumer {
  private worker: Worker;
  
  constructor(private processingService: ProcessingService) {
    this.worker = new Worker(
      'photo-processing',
      async (job) => this.processJob(job),
      {
        connection: {
          host: 'redis',
          port: 6379
        },
        concurrency: 3,             // Process 3 jobs concurrently
        limiter: {
          max: 10,                  // Max 10 jobs
          duration: 1000            // per second
        }
      }
    );
    
    this.setupEventHandlers();
  }
  
  async processJob(job: Job<PhotoProcessingJob>): Promise<ProcessingResult> {
    const { photoId, storage, pipeline, context } = job.data;
    
    logger.info(`Processing job ${job.id} for photo ${photoId}`);
    
    // Update job progress
    await job.updateProgress(10);
    
    // Fetch blob from storage
    const blob = await this.fetchBlob(storage.s3Key);
    await job.updateProgress(20);
    
    // Execute pipeline
    const result = await this.processingService.executePipeline(
      pipeline.name,
      {
        photoId,
        blob,
        metadata: storage
      },
      {
        onStageComplete: async (stage, progress) => {
          await job.updateProgress(20 + (progress * 0.8));
        }
      }
    );
    
    await job.updateProgress(100);
    
    return result;
  }
  
  setupEventHandlers(): void {
    this.worker.on('completed', (job, result) => {
      logger.info(`Job ${job.id} completed`, { photoId: job.data.photoId });
      
      // Publish completion event to Event Bus
      this.publishEvent('photo.processing.completed', {
        photoId: job.data.photoId,
        result
      });
    });
    
    this.worker.on('failed', (job, error) => {
      logger.error(`Job ${job.id} failed`, {
        photoId: job.data.photoId,
        error: error.message,
        attempts: job.attemptsMade
      });
      
      // Publish failure event
      this.publishEvent('photo.processing.failed', {
        photoId: job.data.photoId,
        error: error.message
      });
    });
  }
}
```

---

## 🔔 Event Bus Architecture

The Event Bus is a **separate service** that bridges BullMQ events to WebSocket clients.

### Event Bus Service

```typescript
// Event Bus - Decoupled from API and Workers
class EventBusService {
  private io: Server;                    // Socket.io server
  private redis: Redis;                  // Redis pub/sub
  private roomManager: RoomManager;
  
  constructor() {
    // Setup WebSocket server
    this.io = new Server(3001, {
      cors: { origin: '*' }
    });
    
    // Setup Redis subscriber
    this.redis = new Redis({
      host: 'redis',
      port: 6379
    });
    
    this.roomManager = new RoomManager(this.io);
    this.setupSubscriptions();
    this.setupClientHandlers();
  }
  
  setupSubscriptions(): void {
    // Subscribe to Redis pub/sub channels
    this.redis.subscribe(
      'photo:upload',
      'photo:processing',
      'photo:completion'
    );
    
    this.redis.on('message', (channel, message) => {
      const event = JSON.parse(message);
      this.broadcastEvent(channel, event);
    });
  }
  
  setupClientHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);
      
      // Client identifies itself
      socket.on('identify', ({ clientId, sessionId }) => {
        // Join client-specific room
        this.roomManager.joinRoom(socket, `client:${clientId}`);
        
        // Join session-specific room if provided
        if (sessionId) {
          this.roomManager.joinRoom(socket, `session:${sessionId}`);
        }
        
        socket.emit('identified', { socketId: socket.id });
      });
      
      // Client subscribes to specific photo
      socket.on('subscribe:photo', ({ photoId }) => {
        this.roomManager.joinRoom(socket, `photo:${photoId}`);
      });
    });
  }
  
  broadcastEvent(channel: string, event: any): void {
    const { type, data, metadata } = event;
    
    switch (channel) {
      case 'photo:upload':
        // Broadcast to client and session rooms
        if (metadata.clientId) {
          this.io.to(`client:${metadata.clientId}`).emit('upload.event', event);
        }
        if (metadata.sessionId) {
          this.io.to(`session:${metadata.sessionId}`).emit('upload.event', event);
        }
        break;
        
      case 'photo:processing':
        // Broadcast to photo-specific room
        if (data.photoId) {
          this.io.to(`photo:${data.photoId}`).emit('processing.event', event);
        }
        break;
        
      case 'photo:completion':
        // Broadcast to all relevant rooms
        if (data.photoId) {
          this.io.to(`photo:${data.photoId}`).emit('completion.event', event);
        }
        if (metadata.clientId) {
          this.io.to(`client:${metadata.clientId}`).emit('completion.event', event);
        }
        break;
    }
  }
}

// Event Publishers (used by API and Workers)
class EventPublisher {
  private redis: Redis;
  
  constructor() {
    this.redis = new Redis({
      host: 'redis',
      port: 6379
    });
  }
  
  async publishUploadEvent(event: UploadEvent): Promise<void> {
    await this.redis.publish(
      'photo:upload',
      JSON.stringify({
        type: event.type,
        data: event.data,
        metadata: event.metadata,
        timestamp: new Date().toISOString()
      })
    );
  }
  
  async publishProcessingEvent(event: ProcessingEvent): Promise<void> {
    await this.redis.publish(
      'photo:processing',
      JSON.stringify({
        type: event.type,
        data: event.data,
        metadata: event.metadata,
        timestamp: new Date().toISOString()
      })
    );
  }
}
```

---

## 🔄 Component Interaction Patterns

### 1. API Gateway Responsibilities

```typescript
// API Gateway - Upload Handler
class PhotoUploadHandler {
  constructor(
    private storage: StorageCoordinator,
    private jobProducer: JobProducer,
    private eventPublisher: EventPublisher
  ) {}
  
  async handleUpload(req: Request, res: Response): Promise<void> {
    const { file, clientId, sessionId } = req;
    const photoId = generateUUID();
    const traceId = req.traceId || generateTraceId();
    
    try {
      // 1. Store blob in MinIO
      const storageResult = await this.storage.storePhoto(
        photoId,
        file.buffer,
        {
          originalName: file.originalname,
          mimeType: file.mimetype,
          clientId,
          sessionId
        }
      );
      
      // 2. Create metadata record in SQLite
      await this.storage.createPhotoRecord({
        id: photoId,
        s3Key: storageResult.s3Key,
        s3Url: storageResult.s3Url,
        fileSize: file.size,
        mimeType: file.mimetype,
        clientId,
        sessionId,
        uploadedAt: new Date().toISOString(),
        processingStatus: 'queued'
      });
      
      // 3. Enqueue processing job
      const jobId = await this.jobProducer.enqueuePhotoProcessing(
        photoId,
        {
          s3Key: storageResult.s3Key,
          bucket: storageResult.bucket,
          originalSize: file.size,
          mimeType: file.mimetype
        },
        {
          name: 'full_processing',
          stages: ['validation', 'thumbnails', 'metadata', 'optimization'],
          priority: 5
        }
      );
      
      // 4. Publish upload event
      await this.eventPublisher.publishUploadEvent({
        type: 'photo.uploaded',
        data: {
          photoId,
          s3Url: storageResult.s3Url,
          jobId
        },
        metadata: {
          clientId,
          sessionId,
          traceId
        }
      });
      
      // 5. Return response immediately
      res.status(201).json({
        success: true,
        data: {
          photoId,
          jobId,
          status: 'queued',
          message: 'Photo uploaded and queued for processing'
        }
      });
      
    } catch (error) {
      logger.error('Upload failed', { error, photoId, traceId });
      
      // Cleanup on failure
      if (storageResult?.s3Key) {
        await this.storage.deleteBlob(storageResult.s3Key);
      }
      
      throw error;
    }
  }
}
```

### 2. Worker Responsibilities

```typescript
// Worker - Processing Logic
class PhotoProcessor {
  constructor(
    private storage: StorageCoordinator,
    private pipelineOrchestrator: PipelineOrchestrator,
    private eventPublisher: EventPublisher
  ) {}
  
  async processPhoto(job: Job<PhotoProcessingJob>): Promise<ProcessingResult> {
    const { photoId, storage, pipeline, context } = job.data;
    const traceId = context.traceId;
    
    logger.info(`Starting processing for photo ${photoId}`, { traceId });
    
    try {
      // 1. Fetch blob from MinIO
      const blob = await this.storage.fetchBlob(storage.s3Key);
      await job.updateProgress(20);
      
      // 2. Execute pipeline stages
      const results = await this.pipelineOrchestrator.executePipeline(
        pipeline.name,
        {
          photoId,
          blob,
          metadata: storage
        },
        {
          onStageComplete: async (stageName, stageResult, progress) => {
            await job.updateProgress(20 + (progress * 70));
            
            // Publish stage completion
            await this.eventPublisher.publishProcessingEvent({
              type: 'photo.processing.stage.completed',
              data: {
                photoId,
                stage: stageName,
                result: stageResult
              },
              metadata: { traceId }
            });
          }
        }
      );
      
      // 3. Store processing results
      await this.storeResults(photoId, results);
      await job.updateProgress(95);
      
      // 4. Update database metadata
      await this.storage.updatePhotoProcessing(photoId, {
        processingStatus: 'completed',
        processingMetadata: JSON.stringify(results),
        processedAt: new Date().toISOString()
      });
      await job.updateProgress(100);
      
      // 5. Publish completion event
      await this.eventPublisher.publishProcessingEvent({
        type: 'photo.processing.completed',
        data: {
          photoId,
          results: {
            thumbnails: results.thumbnails.map(t => t.url),
            metadata: results.metadata,
            processingTime: results.totalDuration
          }
        },
        metadata: { traceId, clientId: context.clientId }
      });
      
      logger.info(`Processing completed for photo ${photoId}`, { traceId });
      
      return results;
      
    } catch (error) {
      logger.error(`Processing failed for photo ${photoId}`, {
        error: error.message,
        traceId
      });
      
      // Update database with failure
      await this.storage.updatePhotoProcessing(photoId, {
        processingStatus: 'failed',
        processingError: error.message
      });
      
      throw error;
    }
  }
  
  async storeResults(photoId: string, results: ProcessingResults): Promise<void> {
    // Store thumbnails in MinIO
    for (const thumbnail of results.thumbnails) {
      await this.storage.storeBlob(
        thumbnail.key,
        thumbnail.buffer,
        { contentType: 'image/jpeg' }
      );
    }
    
    // Store optimization results if generated
    if (results.optimized) {
      await this.storage.storeBlob(
        results.optimized.key,
        results.optimized.buffer,
        { contentType: results.optimized.mimeType }
      );
    }
  }
}
```

---

## 🚨 Failure Handling

### BullMQ Retry Strategy

```typescript
// Automatic Retry Configuration
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000              // 5s, 10s, 20s
  },
  
  // Remove completed jobs to save memory
  removeOnComplete: {
    age: 24 * 3600,          // Keep for 24 hours
    count: 1000              // Keep last 1000
  },
  
  // Keep failed jobs for debugging
  removeOnFail: {
    age: 7 * 24 * 3600,      // Keep for 7 days
    count: 5000
  }
};

// Manual Retry Logic for Specific Errors
class ErrorHandler {
  async handleProcessingError(
    job: Job,
    error: ProcessingError
  ): Promise<'retry' | 'fail' | 'defer'> {
    
    switch (error.category) {
      case 'TEMPORARY':
        // Network issues, temporary resource unavailability
        return 'retry';
        
      case 'RESOURCE':
        // Out of memory, disk space - defer to later
        await this.notifyAdmin('Resource exhaustion', error);
        return 'defer';
        
      case 'DATA':
        // Corrupted image, invalid format - permanent failure
        await this.markPhotoAsInvalid(job.data.photoId, error);
        return 'fail';
        
      case 'LOGIC':
        // Programming error - alert developers
        await this.alertDevelopers('Processing logic error', error);
        return 'fail';
        
      default:
        return job.attemptsMade < 3 ? 'retry' : 'fail';
    }
  }
}
```

### Dead Letter Queue

```typescript
// Failed Job Handler
class DeadLetterHandler {
  private dlQueue: Queue;
  
  constructor() {
    this.dlQueue = new Queue('photo-processing-failed', {
      connection: { host: 'redis', port: 6379 }
    });
    
    this.setupFailedJobListener();
  }
  
  setupFailedJobListener(): void {
    // Listen for jobs that exceeded max attempts
    this.worker.on('failed', async (job, error) => {
      if (job.attemptsMade >= job.opts.attempts) {
        // Move to dead letter queue
        await this.dlQueue.add('failed-job', {
          originalJob: job.data,
          error: error.message,
          attempts: job.attemptsMade,
          failedAt: new Date().toISOString()
        });
        
        logger.error(`Job ${job.id} moved to DLQ`, {
          photoId: job.data.photoId,
          error: error.message
        });
        
        // Notify administrators
        await this.notifyAdmin(`Job ${job.id} permanently failed`, {
          photoId: job.data.photoId,
          error: error.message
        });
      }
    });
  }
}
```

---

## 📊 Monitoring & Observability

### BullMQ Metrics

```typescript
// Metrics Collector
class BullMQMetrics {
  async collectQueueMetrics(): Promise<QueueMetrics> {
    const queue = new Queue('photo-processing');
    
    const [
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused
    ] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.getPausedCount()
    ]);
    
    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      total: waiting + active + completed + failed
    };
  }
  
  async getJobStats(period: '1h' | '24h' | '7d'): Promise<JobStats> {
    const queue = new Queue('photo-processing');
    const jobs = await queue.getJobs(['completed', 'failed'], 0, 1000);
    
    const periodMs = this.parsePeriod(period);
    const cutoff = Date.now() - periodMs;
    
    const recentJobs = jobs.filter(j => j.finishedOn && j.finishedOn > cutoff);
    
    const completed = recentJobs.filter(j => j.returnvalue);
    const failed = recentJobs.filter(j => j.failedReason);
    
    return {
      total: recentJobs.length,
      completed: completed.length,
      failed: failed.length,
      successRate: (completed.length / recentJobs.length) * 100,
      avgProcessingTime: this.calculateAvgTime(completed),
      throughput: recentJobs.length / (periodMs / 1000) // jobs per second
    };
  }
}
```

---

## ✅ Benefits of Broker-Centric Design

### 1. **Clean Separation of Concerns**
- API focuses on HTTP/WebSocket, validation, auth
- Workers focus purely on processing logic
- No tight coupling between subsystems

### 2. **Independent Scaling**
- Scale API horizontally for more upload capacity
- Scale workers horizontally for more processing throughput
- Each can be scaled independently based on load

### 3. **Resilience**
- If workers go down, uploads continue (jobs queue up)
- If API goes down, workers continue processing existing jobs
- BullMQ persists jobs to Redis (survives restarts)

### 4. **Observability**
- BullMQ UI provides real-time queue monitoring
- Clear job lifecycle: queued → active → completed/failed
- Easy to track processing bottlenecks

### 5. **Extensibility**
- Add new processing pipelines without touching API code
- Add new job types (e.g., batch operations, scheduled tasks)
- Easy to plug in additional workers for specialized processing

This architecture provides a **clean, scalable, and maintainable** system that aligns with your conceptual model! 🚀
