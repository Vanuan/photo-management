# Photo Management System - Complete Architecture

## 🎯 System Overview

This document provides the complete architectural specification for a photo management platform with **clear separation between client-facing services and backend processing**, coordinated through a robust shared infrastructure layer.

### Core Design Principles

1. **Message-Driven Coordination**: All inter-subsystem communication flows through BullMQ
2. **No Direct Service Communication**: Subsystems interact only via broker, storage, and event bus
3. **Event-Sourced State**: State changes propagate through events, not direct updates
4. **Unified Storage Interface**: Single abstraction layer for MinIO (blobs) and SQLite (metadata)
5. **Resilience-First**: Built-in retry mechanisms, circuit breakers, and graceful degradation

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLIENT + API SUBSYSTEM                           │
├─────────────────────────────────────────────────────────────────────┤
│  📱 Web/Mobile Clients                                              │
│         ↕ HTTPS/WebSocket                                           │
│  🌐 API Gateway                                                     │
│     ├─ Photo Upload Endpoints                                       │
│     ├─ Session Management                                           │
│     ├─ Client Authentication                                        │
│     └─ Request Validation                                           │
│         │                                                           │
│         └──▶ Enqueue job metadata to BullMQ                        │
│              Store blob in MinIO via Storage Coordinator            │
│              Create metadata in SQLite via Storage Coordinator      │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                  SHARED INFRASTRUCTURE LAYER                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📨 Job Queue Coordinator (BullMQ)                                  │
│     ├─ Queue Management & Prioritization                           │
│     ├─ Job Lifecycle & Retry Policies                              │
│     ├─ Worker Pool Management                                      │
│     └─ Dead Letter Queue Handling                                  │
│                                                                     │
│  💾 Storage Coordinator                                             │
│     ├─ MinIO (Blob Storage)                                        │
│     ├─ SQLite (Metadata)                                           │
│     ├─ Transaction Coordination                                    │
│     └─ Consistency Management                                      │
│                                                                     │
│  🔔 Event Bus Service                                               │
│     ├─ Redis Pub/Sub                                               │
│     ├─ WebSocket Bridge                                            │
│     ├─ Room Management                                             │
│     └─ Event Routing & Filtering                                   │
│                                                                     │
│  🔧 Supporting Services                                             │
│     ├─ Configuration Manager                                       │
│     ├─ Security Manager (Auth, Rate Limiting)                      │
│     ├─ Resilience Manager (Circuit Breakers, Retry)                │
│     └─ Monitoring Service (Metrics, Health Checks)                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                    PROCESSING SUBSYSTEM                             │
├─────────────────────────────────────────────────────────────────────┤
│  ⚡ Worker Pool                                                     │
│     ├─ Job Consumer (BullMQ)                                       │
│     ├─ Pipeline Orchestrator                                       │
│     ├─ Processor Registry                                          │
│     └─ Result Publisher                                            │
│         │                                                           │
│         └──▶ Consume jobs from BullMQ                              │
│              Fetch blobs from MinIO via Storage Coordinator         │
│              Execute pipeline stages (validation, thumbnails, etc)  │
│              Store results back to MinIO & SQLite                   │
│              Publish completion events to Event Bus                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Data Flow: Photo Upload to Processing

### Detailed Sequence

```
1. CLIENT CAPTURE & UPLOAD
   ├─ User captures photo
   ├─ Client caches locally (localStorage)
   ├─ Client uploads via POST /api/photos/upload
   └─ Client subscribes to WebSocket for status updates

2. API GATEWAY PROCESSING
   ├─ Validate request (auth, file type, size)
   ├─ Generate photoId (UUID)
   ├─ Store blob via StorageCoordinator.storeBlob()
   │  └─ MinIO stores original image
   ├─ Create metadata via StorageCoordinator.createRecord()
   │  └─ SQLite creates photo record (status: 'queued')
   ├─ Enqueue job via JobQueueCoordinator.enqueueJob()
   │  └─ BullMQ receives job metadata with s3Key, pipeline config
   ├─ Publish event via EventBusService.publishEvent()
   │  └─ Redis pub/sub broadcasts 'photo.uploaded' event
   └─ Return 201 response with photoId and jobId

3. EVENT BUS NOTIFICATION
   ├─ Event Bus receives 'photo.uploaded' from Redis pub/sub
   ├─ Routes event to appropriate WebSocket rooms
   │  ├─ Client room (client:${clientId})
   │  ├─ Session room (session:${sessionId})
   │  └─ Photo room (photo:${photoId})
   └─ Client receives real-time notification

4. JOB QUEUE PROCESSING
   ├─ BullMQ holds job in priority queue
   ├─ Worker polls queue and dequeues job
   ├─ Worker validates job data
   └─ Worker begins processing

5. WORKER PROCESSING
   ├─ Fetch blob via StorageCoordinator.fetchBlob()
   │  └─ MinIO retrieves original image
   ├─ Execute pipeline stages:
   │  ├─ Validation (format check, integrity)
   │  ├─ Metadata extraction (EXIF, dimensions)
   │  ├─ Thumbnail generation (150px, 300px, 600px)
   │  └─ Image optimization (compression, format conversion)
   ├─ For each stage:
   │  ├─ Update job progress
   │  ├─ Publish 'photo.processing.stage.completed' event
   │  └─ Store intermediate results
   ├─ Store processing results:
   │  ├─ Upload thumbnails to MinIO
   │  └─ Update photo metadata in SQLite
   └─ Mark job complete in BullMQ

6. COMPLETION NOTIFICATION
   ├─ Worker publishes 'photo.processing.completed' event
   ├─ Event Bus broadcasts to WebSocket clients
   ├─ Client receives completion notification
   └─ Client updates UI (gallery refresh, status update)

7. ERROR HANDLING (if any stage fails)
   ├─ Worker catches error
   ├─ Resilience Manager determines retry strategy
   ├─ If retryable: BullMQ reschedules with backoff
   ├─ If not retryable: Move to dead letter queue
   ├─ Update photo status to 'failed' in SQLite
   └─ Publish 'photo.processing.failed' event
```

---

## 📨 Job Queue Coordinator

### Architecture

```typescript
interface JobQueueCoordinator {
  // Queue Management
  enqueueJob(queueName: string, jobName: string, data: any, opts?: JobOptions): Promise<Job>;
  getJob(jobId: string): Promise<Job | null>;
  getJobStatus(jobId: string): Promise<JobStatus>;

  // Worker Management
  createWorker(queueName: string, processor: JobProcessor, opts?: WorkerOptions): Worker;
  getWorkerMetrics(queueName: string): Promise<WorkerMetrics>;

  // Queue Operations
  getQueueMetrics(queueName: string): Promise<QueueMetrics>;
  pauseQueue(queueName: string): Promise<void>;
  resumeQueue(queueName: string): Promise<void>;
  drainQueue(queueName: string): Promise<void>;

  // Dead Letter Queue
  getFailedJobs(queueName: string, start?: number, end?: number): Promise<Job[]>;
  retryFailedJob(jobId: string): Promise<void>;
}

// Photo Processing Job Structure
interface PhotoProcessingJob {
  // Identity
  id: string;
  photoId: string;

  // Storage References (NO blobs - only keys)
  storage: {
    s3Key: string;
    bucket: string;
    originalSize: number;
    mimeType: string;
    etag?: string;
  };

  // Processing Configuration
  pipeline: {
    name: string;              // 'full_processing' | 'quick_processing'
    stages: string[];          // ['validation', 'thumbnails', 'metadata']
    priority: number;          // 1-10
  };

  // Context for tracing
  context: {
    clientId: string;
    sessionId?: string;
    uploadedAt: string;
    traceId: string;
  };
}
```

### BullMQ Configuration

```typescript
// Queue Options
const queueConfig = {
  connection: {
    host: process.env.REDIS_HOST,
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
};

// Worker Options
const workerConfig = {
  concurrency: 3,               // Process 3 jobs concurrently
  limiter: {
    max: 10,                    // Max 10 jobs
    duration: 1000              // per second
  },
  settings: {
    stalledInterval: 30000,     // Check for stalled jobs every 30s
    maxStalledCount: 1          // Max 1 stalled attempt
  }
};
```

---

## 💾 Storage Coordinator

### Unified Interface

```typescript
interface StorageCoordinator {
  // Blob Operations
  storeBlob(key: string, data: Buffer, metadata?: BlobMetadata): Promise<StorageResult>;
  fetchBlob(key: string): Promise<Buffer>;
  deleteBlob(key: string): Promise<void>;

  // Metadata Operations
  createRecord<T>(table: string, data: T): Promise<string>;
  updateRecord<T>(table: string, id: string, data: Partial<T>): Promise<void>;
  getRecord<T>(table: string, id: string): Promise<T | null>;
  queryRecords<T>(table: string, query: QueryOptions): Promise<QueryResult<T>>;

  // Transaction Support
  beginTransaction(): Promise<Transaction>;

  // Consistency
  ensureConsistency(): Promise<ConsistencyReport>;
}

interface Transaction {
  createRecord<T>(table: string, data: T): Promise<string>;
  updateRecord<T>(table: string, id: string, data: Partial<T>): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

### Database Schema

```sql
-- Photos table
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  s3_key TEXT NOT NULL UNIQUE,
  s3_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,

  client_id TEXT NOT NULL,
  session_id TEXT,

  processing_status TEXT NOT NULL DEFAULT 'queued',
  processing_metadata TEXT,
  processing_error TEXT,

  uploaded_at TEXT NOT NULL,
  processing_started_at TEXT,
  processing_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (processing_status IN ('queued', 'processing', 'completed', 'failed'))
);

-- Thumbnails table
CREATE TABLE thumbnails (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  size_name TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  s3_url TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_photos_client_id ON photos(client_id);
CREATE INDEX idx_photos_session_id ON photos(session_id);
CREATE INDEX idx_photos_processing_status ON photos(processing_status);
CREATE INDEX idx_photos_uploaded_at ON photos(uploaded_at DESC);
CREATE INDEX idx_thumbnails_photo_id ON thumbnails(photo_id);
```

---

## 🔔 Event Bus Service

### Architecture

```typescript
interface EventBusService {
  // Publishing (Redis Pub/Sub)
  publishEvent(channel: string, event: Event): Promise<void>;

  // Subscription (Backend Services)
  subscribe(channel: string, handler: EventHandler): Promise<Subscription>;
  unsubscribe(subscriptionId: string): Promise<void>;

  // WebSocket Management (Client Connections)
  broadcastToRoom(room: string, event: Event): Promise<void>;
  broadcastToClient(clientId: string, event: Event): Promise<void>;

  // Room Management
  joinRoom(socketId: string, room: string): void;
  leaveRoom(socketId: string, room: string): void;
}

// Event Types
type EventType =
  | 'photo.uploaded'
  | 'photo.processing.started'
  | 'photo.processing.stage.completed'
  | 'photo.processing.completed'
  | 'photo.processing.failed'
  | 'photo.thumbnail.generated';

interface Event {
  id: string;
  type: EventType;
  data: any;
  metadata: {
    source: string;
    clientId?: string;
    sessionId?: string;
    traceId: string;
    version: string;
  };
  timestamp: string;
}
```

### WebSocket Room Structure

```typescript
// Room Types
const ROOM_TYPES = {
  CLIENT: 'client:${clientId}',      // All events for a client
  SESSION: 'session:${sessionId}',    // All events for a session
  PHOTO: 'photo:${photoId}',          // All events for a photo
  GLOBAL: 'global'                    // System-wide events
};

// Client Connection Flow
class EventBusService {
  onClientConnect(socket: Socket): void {
    socket.on('identify', ({ clientId, sessionId }) => {
      // Join client-specific room
      socket.join(`client:${clientId}`);

      // Join session room if provided
      if (sessionId) {
        socket.join(`session:${sessionId}`);
      }

      socket.emit('identified', { socketId: socket.id });
    });

    socket.on('subscribe:photo', ({ photoId }) => {
      socket.join(`photo:${photoId}`);
    });
  }

  async broadcastEvent(channel: string, event: Event): Promise<void> {
    const { clientId, sessionId } = event.metadata;

    // Broadcast to appropriate rooms
    if (clientId) {
      this.io.to(`client:${clientId}`).emit('event', event);
    }

    if (sessionId) {
      this.io.to(`session:${sessionId}`).emit('event', event);
    }

    if (event.data.photoId) {
      this.io.to(`photo:${event.data.photoId}`).emit('event', event);
    }
  }
}
```

---

## 🚨 Error Handling & Resilience

### Error Classification

```typescript
enum ErrorCategory {
  TEMPORARY = 'temporary',        // Network issues, retryable
  RESOURCE = 'resource',          // Memory, disk, rate limits
  DATA = 'data',                  // Corrupted data, invalid format
  LOGIC = 'logic',                // Programming errors
  SECURITY = 'security',          // Auth failures
  CONFIGURATION = 'configuration' // Invalid config
}

interface ErrorHandlingStrategy {
  category: ErrorCategory;
  retryable: boolean;
  maxRetries: number;
  backoffStrategy: {
    type: 'fixed' | 'exponential' | 'linear';
    baseDelay: number;
    maxDelay: number;
    jitter: boolean;
  };
  escalationThreshold: number;
  alertLevel: 'none' | 'info' | 'warn' | 'error' | 'critical';
}
```

### Resilience Manager

```typescript
class ResilienceManager {
  async handleError(error: Error, context: ErrorContext): Promise<ErrorHandlingResult> {
    // 1. Classify error
    const category = this.classifyError(error);
    const strategy = this.getErrorStrategy(category);

    // 2. Check circuit breaker
    const circuitBreaker = this.getCircuitBreaker(context.service);
    if (!circuitBreaker.canExecute()) {
      return { action: 'degrade', delay: 0 };
    }

    // 3. Determine retry
    if (!strategy.retryable || context.attemptCount >= strategy.maxRetries) {
      return { action: 'fail', delay: 0 };
    }

    // 4. Calculate delay
    const delay = this.calculateRetryDelay(strategy, context.attemptCount);

    // 5. Escalate if needed
    if (context.attemptCount >= strategy.escalationThreshold) {
      await this.escalateError(error, category, context);
    }

    return {
      action: 'retry',
      delay,
      newAttemptCount: context.attemptCount + 1
    };
  }
}
```

---

## 📊 Monitoring & Observability

### Metrics Collection

```typescript
interface MetricsCollector {
  // Standard metrics
  incrementCounter(name: string, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;

  // Export
  exportPrometheus(): Promise<string>;
}

// Key Metrics
const METRICS = {
  // Job Queue
  'job_queue_size': 'Gauge - Current queue depth',
  'job_processing_duration_ms': 'Histogram - Job processing time',
  'job_failures_total': 'Counter - Job failures by error type',

  // Storage
  'storage_operations_total': 'Counter - Storage operations',
  'storage_operation_duration_ms': 'Histogram - Operation latency',
  'storage_size_bytes': 'Gauge - Total storage used',

  // Event Bus
  'events_published_total': 'Counter - Events published',
  'websocket_connections_active': 'Gauge - Active WebSocket connections',
  'event_delivery_duration_ms': 'Histogram - Event delivery time'
};
```

### Health Checks

```typescript
interface HealthCheckService {
  runAllChecks(): Promise<HealthCheckSummary>;
}

const HEALTH_CHECKS = {
  redis: 'Redis connectivity and latency',
  minio: 'MinIO connectivity and write test',
  sqlite: 'Database connectivity and integrity',
  system_resources: 'Memory and CPU usage',
  worker_pool: 'Worker availability and health'
};
```

---

## 🚀 Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  # Shared Infrastructure
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis_data:/data]

  minio:
    image: minio/minio:latest
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
    command: server /data --console-address ":9001"
    volumes: [minio_data:/data]

  shared-infrastructure:
    build: ./shared-infrastructure
    ports:
      - "3001:3001"  # Event Bus WebSocket
      - "3002:3002"  # Health Check
      - "3003:3003"  # Metrics
    environment:
      REDIS_HOST: redis
      MINIO_ENDPOINT: minio
    depends_on: [redis, minio]

  # API Gateway
  api-gateway:
    build: ./api-gateway
    ports: ["3000:3000"]
    environment:
      REDIS_HOST: redis
      MINIO_ENDPOINT: minio
    depends_on: [shared-infrastructure]

  # Processing Workers
  worker:
    build: ./worker
    deploy:
      replicas: 3
    environment:
      REDIS_HOST: redis
      MINIO_ENDPOINT: minio
    depends_on: [shared-infrastructure]

volumes:
  redis_data:
  minio_data:
```

---

## ✅ Key Benefits

### 1. **Clean Separation**
- API and Workers never communicate directly
- All coordination through broker and storage
- Clear ownership of responsibilities

### 2. **Independent Scaling**
- Scale API for upload capacity
- Scale workers for processing throughput
- Each scales independently

### 3. **Resilience**
- Workers down? Uploads continue (jobs queue)
- API down? Workers process existing jobs
- BullMQ persists jobs to Redis

### 4. **Observability**
- BullMQ UI for queue monitoring
- Prometheus metrics for performance
- Distributed tracing via trace IDs
- Health checks for each component

### 5. **Extensibility**
- Add new pipelines without API changes
- Add new job types easily
- Plug in additional workers

This architecture provides a **production-ready, scalable foundation** for the photo management system! 🚀
