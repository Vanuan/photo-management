# Shared Infrastructure Layer - Design Document

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Component Specifications](#2-component-specifications)
- [3. Data Models & Schemas](#3-data-models--schemas)
- [4. Configuration Management](#4-configuration-management)
- [5. Error Handling & Resilience](#5-error-handling--resilience)
- [6. Security & Access Control](#6-security--access-control)
- [7. Monitoring & Observability](#7-monitoring--observability)
- [8. Deployment & Operations](#8-deployment--operations)
- [9. Performance & Scaling](#9-performance--scaling)
- [10. Implementation Guidelines](#10-implementation-guidelines)

---

## 1. Architecture Overview

### 1.1 Design Philosophy

The Shared Infrastructure Layer serves as the **coordination backbone** between the Client+API and Processing subsystems. It follows these core principles:

- **Message-Driven Architecture**: All inter-subsystem communication flows through message queues
- **Event-Sourced Coordination**: State changes are propagated via events, not direct database updates
- **Storage Abstraction**: Unified interface for blob storage (MinIO) and metadata persistence (SQLite)
- **Resilience-First**: Built-in retry mechanisms, circuit breakers, and graceful degradation

### 1.2 Component Landscape

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE LAYER                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │   Job Queue     │  │  Storage Layer  │  │   Event Bus     │      │
│  │   Coordinator   │  │   Coordinator   │  │   Service       │      │
│  │                 │  │                 │  │                 │      │
│  │  • BullMQ       │  │  • MinIO        │  │  • Redis Pub/Sub│      │
│  │  • Redis        │  │  • SQLite       │  │  • WebSocket    │      │
│  │  • Queue Mgmt   │  │  • Consistency  │  │  • Room Mgmt    │      │
│  │  • Priority     │  │    Manager      │  │  • Event Router │      │
│  │  • Retry Logic  │  │  • Blob Storage │  │  • Subscription │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│           │                     │                     │              │
│           └─────────────────────┼─────────────────────┘              │
│                                 │                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  Configuration  │  │    Security     │  │   Monitoring    │      │
│  │    Manager      │  │    Manager      │  │    & Metrics    │      │
│  │                 │  │                 │  │                 │      │
│  │  • Environment  │  │  • Auth Tokens  │  │  • Health Check │      │
│  │  • Feature Flags│  │  • Rate Limits  │  │  • Metrics      │      │
│  │  • Dynamic      │  │  • Encryption   │  │  • Tracing      │      │
│  │    Config       │  │  • Access Ctrl  │  │  • Alerting     │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Responsibilities

| Component | Primary Responsibility | Secondary Responsibilities |
|-----------|----------------------|---------------------------|
| **Job Queue Coordinator** | Message routing, job lifecycle management | Priority scheduling, retry policies, dead letter handling (see [Job Queue Coordinator Design](./job-queue-coordinator-design.md)) |
| **Storage Layer Coordinator** | Unified storage interface, consistency | Blob management, metadata persistence, transaction coordination (see [Storage Layer Design](./storage/storage-layer-design.md)) |
| **Event Bus Service** | Real-time event propagation | Client room management, subscription routing, event filtering |
| **Configuration Manager** | Environment configuration, feature flags | Dynamic reconfiguration, validation, schema management |
| **Security Manager** | Authentication, authorization, encryption | Rate limiting, audit logging, threat detection |
| **Monitoring Service** | Health checks, metrics collection | Performance monitoring, alerting, distributed tracing |

---

## 2. Component Specifications

### 2.1 Job Queue Coordinator

> **Note**: The Job Queue Coordinator has been moved to a separate design document for better modularity and focused documentation. See [Job Queue Coordinator Design Document](./job-queue-coordinator-design.md) for complete specifications including:
>
> - Core architecture and interfaces
> - Queue management and configuration
> - Job scheduling and prioritization
> - Worker management and scaling
> - Error handling and resilience patterns
> - Monitoring and observability
> - Performance optimization strategies

### 2.2 Storage Layer Coordinator

> **Note**: The Storage Layer Coordinator has been moved to a separate design document for better modularity and focused documentation. See [Storage Layer Design Document](./storage/storage-layer-design.md) for complete specifications including:
>
> - Unified storage interface and operations
> - MinIO and SQLite integration
> - Transaction management and consistency
> - Performance optimization strategies
> - Data integrity and validation
> - Advanced query operations
> - Consistency management and repair
> - Monitoring and observability

#### 2.2.1 Core Interface

The Storage Layer Coordinator provides a unified interface for all storage operations:

```typescript
interface StorageCoordinator {
  // Blob Operations
  storeBlob(key: string, data: Buffer, metadata?: BlobMetadata): Promise<StorageResult>;
  fetchBlob(key: string): Promise<Buffer>;
  getBlobStream(key: string): Promise<ReadableStream>;
  deleteBlob(key: string): Promise<void>;

  // Batch Operations
  storeBlobsBatch(blobs: BlobBatch[]): Promise<StorageResult[]>;
  fetchBlobsBatch(keys: string[]): Promise<Buffer[]>;

  // Metadata Operations
  createRecord<T>(table: string, data: T): Promise<string>;
  updateRecord<T>(table: string, id: string, data: Partial<T>): Promise<void>;
  getRecord<T>(table: string, id: string): Promise<T | null>;
  queryRecords<T>(table: string, query: QueryOptions): Promise<QueryResult<T>>;

  // Transaction Support
  beginTransaction(): Promise<Transaction>;

  // Consistency Operations
  ensureConsistency(operation: ConsistencyCheck): Promise<ConsistencyResult>;
}
```

#### 2.2.2 Key Features

- **Unified Interface**: Single API for both blob storage (MinIO) and metadata (SQLite)
- **ACID Transactions**: Full transaction support across both storage systems
- **Consistency Management**: Automated detection and repair of data inconsistencies
- **Performance Optimization**: Intelligent caching, batching, and connection pooling
- **Data Integrity**: Checksum validation and corruption detection
- **Advanced Querying**: Full-text search, aggregation, and time-series queries

### 2.3 Event Bus Service

#### 2.3.1 Event Bus Architecture

```typescript
interface EventBusService {
  // Publishing
  publishEvent(channel: string, event: Event): Promise<void>;
  publishEventBatch(events: ChannelEvent[]): Promise<void>;

  // Subscription Management
  subscribe(channel: string, handler: EventHandler): Promise<Subscription>;
  unsubscribe(subscriptionId: string): Promise<void>;

  // WebSocket Management
  registerClient(socketId: string, clientInfo: ClientInfo): void;
  unregisterClient(socketId: string): void;
  joinRoom(socketId: string, room: string): void;
  leaveRoom(socketId: string, room: string): void;

  // Room Operations
  broadcastToRoom(room: string, event: Event): Promise<void>;
  getRoomMembers(room: string): string[];
  getRoomCount(room: string): number;

  // Event Filtering
  addFilter(filterId: string, filter: EventFilter): void;
  removeFilter(filterId: string): void;

  // Monitoring
  getEventMetrics(timeRange?: TimeRange): Promise<EventMetrics>;
  getConnectionMetrics(): Promise<ConnectionMetrics>;
}

interface Event {
  id: string;
  type: string;
  data: any;
  metadata: EventMetadata;
  timestamp: string;
}

interface EventMetadata {
  source: string;
  traceId?: string;
  clientId?: string;
  sessionId?: string;
  version: string;
}

interface EventFilter {
  type: 'include' | 'exclude';
  conditions: FilterCondition[];
  action: FilterAction;
}

interface FilterCondition {
  field: string;           // e.g., 'type', 'metadata.clientId'
  operator: 'eq' | 'ne' | 'in' | 'contains' | 'regex';
  value: any;
}

interface FilterAction {
  type: 'drop' | 'transform' | 'route';
  params?: any;
}
```

#### 2.3.2 Event Bus Implementation

```typescript
class EventBusServiceImpl implements EventBusService {
  private io: Server;
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private roomManager: RoomManager;
  private subscriptions: Map<string, Subscription> = new Map();
  private filters: Map<string, EventFilter> = new Map();
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(private config: EventBusConfig) {
    // Initialize Socket.IO server
    this.io = new Server(config.websocket.port, {
      cors: { origin: config.websocket.corsOrigins },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Initialize Redis clients
    this.redisPublisher = new Redis(config.redis);
    this.redisSubscriber = new Redis(config.redis);

    this.roomManager = new RoomManager(this.io);
    this.metrics = new MetricsCollector();
    this.logger = new Logger('EventBusService');

    this.setupRedisSubscriptions();
    this.setupWebSocketHandlers();
  }

  async publishEvent(channel: string, event: Event): Promise<void> {
    const startTime = Date.now();

    try {
      // Apply outbound filters
      const filteredEvent = this.applyFilters(event, 'outbound');
      if (!filteredEvent) {
        this.logger.debug(`Event filtered out`, { eventId: event.id, channel });
        return;
      }

      // Publish to Redis
      await this.redisPublisher.publish(channel, JSON.stringify(filteredEvent));

      // Update metrics
      this.metrics.incrementCounter('events_published_total', {
        channel,
        event_type: event.type
      });

      this.metrics.recordHistogram('event_publish_duration_ms', Date.now() - startTime);

      this.logger.debug(`Event published`, {
        eventId: event.id,
        channel,
        type: event.type,
        duration: Date.now() - startTime
      });

    } catch (error) {
      this.metrics.incrementCounter('event_publish_errors_total', {
        channel,
        error_type: error.constructor.name
      });

      this.logger.error(`Failed to publish event`, {
        eventId: event.id,
        channel,
        error: error.message
      });

      throw error;
    }
  }

  async subscribe(channel: string, handler: EventHandler): Promise<Subscription> {
    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      channel,
      handler,
      createdAt: new Date()
    };

    // Subscribe to Redis channel if not already subscribed
    if (!this.subscriptions.has(channel)) {
      await this.redisSubscriber.subscribe(channel);
      this.logger.info(`Subscribed to Redis channel`, { channel });
    }

    this.subscriptions.set(subscriptionId, subscription);

    this.metrics.incrementCounter('subscriptions_created_total', { channel });

    return subscription;
  }

  private setupRedisSubscriptions(): void {
    this.redisSubscriber.on('message', async (channel, message) => {
      try {
        const event: Event = JSON.parse(message);

        // Apply inbound filters
        const filteredEvent = this.applyFilters(event, 'inbound');
        if (!filteredEvent) {
          return;
        }

        // Route to WebSocket clients
        await this.routeEventToWebSocket(channel, filteredEvent);

        // Route to subscriptions
        await this.routeEventToSubscriptions(channel, filteredEvent);

        // Update metrics
        this.metrics.incrementCounter('events_received_total', {
          channel,
          event_type: filteredEvent.type
        });

      } catch (error) {
        this.metrics.incrementCounter('event_processing_errors_total', {
          channel,
          error_type: error.constructor.name
        });

        this.logger.error(`Failed to process event`, {
          channel,
          error: error.message,
          message: message.substring(0, 100)
        });
      }
    });
  }

  private async routeEventToWebSocket(channel: string, event: Event): Promise<void> {
    const routingRules = this.getRoutingRules(channel, event);

    for (const rule of routingRules) {
      switch (rule.type) {
        case 'room':
          this.io.to(rule.target).emit(rule.eventName || 'event', event);
          break;
        case 'client':
          this.io.to(`client:${rule.target}`).emit(rule.eventName || 'event', event);
          break;
        case 'broadcast':
          this.io.emit(rule.eventName || 'event', event);
          break;
      }
    }
  }

  private async routeEventToSubscriptions(channel: string, event: Event): Promise<void> {
    const channelSubscriptions = Array.from(this.subscriptions.values())
      .filter(sub => sub.channel === channel);

    for (const subscription of channelSubscriptions) {
      try {
        await subscription.handler(event);
      } catch (error) {
        this.logger.error(`Subscription handler failed`, {
          subscriptionId: subscription.id,
          error: error.message
        });
      }
    }
  }

  private getRoutingRules(channel: string, event: Event): RoutingRule[] {
    const rules: RoutingRule[] = [];

    switch (channel) {
      case 'photo:upload':
        if (event.metadata.clientId) {
          rules.push({
            type: 'client',
            target: event.metadata.clientId,
            eventName: 'upload.event'
          });
        }
        if (event.metadata.sessionId) {
          rules.push({
            type: 'room',
            target: `session:${event.metadata.sessionId}`,
            eventName: 'upload.event'
          });
        }
        break;

      case 'photo:processing':
        if (event.data.photoId) {
          rules.push({
            type: 'room',
            target: `photo:${event.data.photoId}`,
            eventName: 'processing.event'
          });
        }
        break;

      case 'photo:completion':
        if (event.data.photoId) {
          rules.push({
            type: 'room',
            target: `photo:${event.data.photoId}`,
            eventName: 'completion.event'
          });
        }
        if (event.metadata.clientId) {
          rules.push({
            type: 'client',
            target: event.metadata.clientId,
            eventName: 'completion.event'
          });
        }
        break;
    }

    return rules;
  }

  private setupWebSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      this.logger.info(`WebSocket client connected`, { socketId: socket.id });

      socket.on('identify', (clientInfo: ClientInfo) => {
        this.registerClient(socket.id, clientInfo);

        // Join client-specific room
        socket.join(`client:${clientInfo.clientId}`);

        // Join session-specific room if provided
        if (clientInfo.sessionId) {
          socket.join(`session:${clientInfo.sessionId}`);
        }

        socket.emit('identified', {
          socketId: socket.id,
          timestamp: new Date().toISOString()
        });

        this.logger.info(`Client identified`, {
          socketId: socket.id,
          clientId: clientInfo.clientId,
          sessionId: clientInfo.sessionId
        });
      });

      socket.on('subscribe:photo', ({ photoId }) => {
        socket.join(`photo:${photoId}`);
        socket.emit('subscribed', { room: `photo:${photoId}` });
      });

      socket.on('unsubscribe:photo', ({ photoId }) => {
        socket.leave(`photo:${photoId}`);
        socket.emit('unsubscribed', { room: `photo:${photoId}` });
      });

      socket.on('disconnect', () => {
        this.unregisterClient(socket.id);
        this.logger.info(`WebSocket client disconnected`, { socketId: socket.id });
      });
    });
  }

  registerClient(socketId: string, clientInfo: ClientInfo): void {
    this.roomManager.registerClient(socketId, clientInfo);

    this.metrics.incrementCounter('websocket_connections_total');
    this.metrics.setGauge('websocket_active_connections', this.io.engine.clientsCount);
  }

  unregisterClient(socketId: string): void {
    this.roomManager.unregisterClient(socketId);

    this.metrics.decrementGauge('websocket_active_connections');
  }

  private applyFilters(event: Event, direction: 'inbound' | 'outbound'): Event | null {
    for (const filter of this.filters.values()) {
      if (!this.matchesFilterConditions(event, filter.conditions)) {
        continue;
      }

      switch (filter.action.type) {
        case 'drop':
          return null;

        case 'transform':
          return this.transformEvent(event, filter.action.params);

        case 'route':
          // Custom routing logic
          break;
      }
    }

    return event;
  }

  private matchesFilterConditions(event: Event, conditions: FilterCondition[]): boolean {
    return conditions.every(condition => {
      const fieldValue = this.getEventFieldValue(event, condition.field);

      switch (condition.operator) {
        case 'eq':
          return fieldValue === condition.value;
        case 'ne':
          return fieldValue !== condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(fieldValue);
        case 'contains':
          return typeof fieldValue === 'string' && fieldValue.includes(condition.value);
        case 'regex':
          return typeof fieldValue === 'string' && new RegExp(condition.value).test(fieldValue);
        default:
          return false;
      }
    });
  }

  private getEventFieldValue(event: Event, fieldPath: string): any {
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], event);
  }

  private transformEvent(event: Event, transformParams: any): Event {
    // Implementation of event transformation logic
    return { ...event, ...transformParams };
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

interface RoutingRule {
  type: 'room' | 'client' | 'broadcast';
  target: string;
  eventName?: string;
}

interface ClientInfo {
  clientId: string;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
}

interface Subscription {
  id: string;
  channel: string;
  handler: EventHandler;
  createdAt: Date;
}

type EventHandler = (event: Event) => Promise<void> | void;
```

---

## 3. Data Models & Schemas

### 3.1 Job Schema Definitions

```typescript
// Core Job Types
interface PhotoProcessingJob {
  // Identity
  id: string;
  photoId: string;

  // Storage References
  storage: {
    s3Key: string;
    bucket: string;
    originalSize: number;
    mimeType: string;
    etag?: string;
  };

  // Processing Configuration
  pipeline: {
    name: string;
    stages: ProcessingStage[];
    priority: number;
    configuration?: PipelineConfig;
  };

  // Context
  context: {
    clientId: string;
    sessionId?: string;
    uploadedAt: string;
    traceId: string;
    retryCount?: number;
  };

  // Metadata
  metadata: {
    originalFilename?: string;
    fileSize: number;
    dimensions?: { width: number; height: number };
    exifData?: Record<string, any>;
  };
}

interface ProcessingStage {
  name: string;
  enabled: boolean;
  configuration?: Record<string, any>;
  dependencies?: string[];
  timeout?: number;
}

interface PipelineConfig {
  thumbnailSizes?: ThumbnailSize[];
  compressionQuality?: number;
  outputFormat?: string;
  preserveExif?: boolean;
  watermark?: WatermarkConfig;
}

interface ThumbnailSize {
  name: string;
  width: number;
  height: number;
  crop?: boolean;
}

interface WatermarkConfig {
  enabled: boolean;
  text?: string;
  image?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity: number;
}
```

### 3.2 Storage Schema Definitions

> **Note**: Complete storage schemas and data models have been moved to the [Storage Layer Design Document](./storage/storage-layer-design.md#data-models--schemas). This includes:
>
> - SQLite database schema with indexes and triggers
> - TypeScript interfaces for all entity types
> - Search index configuration (FTS5)
> - Processing metadata structures
> - Query result interfaces

#### 3.2.1 Core Storage Entities

```typescript
// Core photo metadata
interface PhotoRecord {
  id: string;
  s3_key: string;
  s3_url: string;
  bucket: string;
  file_size: number;
  mime_type: string;
  original_filename: string;
  client_id: string;
  processing_status: 'queued' | 'in_progress' | 'completed' | 'failed';
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

// Thumbnail/variant storage
interface ThumbnailRecord {
  id: string;
  photo_id: string;
  variant_type: 'thumbnail' | 'preview' | 'optimized';
  size_name: string;
  s3_key: string;
  width: number;
  height: number;
  file_size: number;
  created_at: string;
}
```

### 3.3 Event Schema Definitions

```typescript
// Event Types
type EventType =
  | 'photo.uploaded'
  | 'photo.processing.started'
  | 'photo.processing.stage.completed'
  | 'photo.processing.completed'
  | 'photo.processing.failed'
  | 'photo.thumbnail.generated'
  | 'system.health.check'
  | 'system.maintenance.started'
  | 'system.maintenance.completed';

interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: string;
  metadata: EventMetadata;
}

interface PhotoUploadedEvent extends BaseEvent {
  type: 'photo.uploaded';
  data: {
    photoId: string;
    s3Url: string;
    fileSize: number;
    mimeType: string;
    jobId: string;
  };
}

interface PhotoProcessingStartedEvent extends BaseEvent {
  type: 'photo.processing.started';
  data: {
    photoId: string;
    jobId: string;
    pipeline: string;
    estimatedDuration?: number;
  };
}

interface PhotoProcessingStageCompletedEvent extends BaseEvent {
  type: 'photo.processing.stage.completed';
  data: {
    photoId: string;
    jobId: string;
    stage: string;
    duration: number;
    output?: any;
    progress: number; // 0-100
  };
}

interface PhotoProcessingCompletedEvent extends BaseEvent {
  type: 'photo.processing.completed';
  data: {
    photoId: string;
    jobId: string;
    results: {
      thumbnails: Array<{
        size: string;
        url: string;
        dimensions: { width: number; height: number };
      }>;
      metadata: Record<string, any>;
      processingTime: number;
      stages: string[];
    };
  };
}

interface PhotoProcessingFailedEvent extends BaseEvent {
  type: 'photo.processing.failed';
  data: {
    photoId: string;
    jobId: string;
    error: string;
    stage?: string;
    retryAttempt: number;
    maxRetries: number;
  };
}
```

---

## 4. Configuration Management

### 4.1 Configuration Schema

```typescript
interface SharedInfrastructureConfig {
  // Environment
  environment: 'development' | 'staging' | 'production';
  version: string;

  // Job Queue Configuration
  jobQueue: {
    redis: RedisConfig;
    defaultJobOptions: DefaultJobOptions;
    queues: Record<string, QueueConfig>;
    workers: Record<string, WorkerConfig>;
  };

  // Storage Configuration
  storage: {
    minio: MinIOConfig;
    sqlite: SQLiteConfig;
    consistency: ConsistencyConfig;
  };

  // Event Bus Configuration
  eventBus: {
    redis: RedisConfig;
    websocket: WebSocketConfig;
    filters: EventFilterConfig[];
    routing: RoutingConfig;
  };

  // Security Configuration
  security: {
    encryption: EncryptionConfig;
    rateLimit: RateLimitConfig;
    authentication: AuthConfig;
  };

  // Monitoring Configuration
  monitoring: {
    metrics: MetricsConfig;
    logging: LoggingConfig;
    tracing: TracingConfig;
    healthCheck: HealthCheckConfig;
  };
}

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  retryDelayOnFailover?: number;
  enableOfflineQueue?: boolean;
  lazyConnect?: boolean;
}

interface DefaultJobOptions {
  attempts: number;
  backoff: {
    type: 'fixed' | 'exponential';
    delay: number;
    maxDelay?: number;
  };
  removeOnComplete: number | boolean;
  removeOnFail: number | boolean;
  jobId?: string;
  priority: number;
  delay?: number;
  repeatJobKey?: string;
}

interface QueueConfig {
  name: string;
  concurrency: number;
  rateLimit?: {
    max: number;
    duration: number;
  };
  settings: {
    stalledInterval: number;
    retryProcessDelay: number;
    maxStalledCount: number;
  };
}

interface MinIOConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  region?: string;
  buckets: BucketConfig[];
}

interface BucketConfig {
  name: string;
  versioning?: boolean;
  encryption?: boolean;
  lifecycle?: LifecycleRule[];
}

interface WebSocketConfig {
  port: number;
  corsOrigins: string[];
  pingTimeout: number;
  pingInterval: number;
  maxHttpBufferSize: number;
  transports: ('websocket' | 'polling')[];
}
```

### 4.2 Configuration Manager Implementation

```typescript
class ConfigurationManager {
  private config: SharedInfrastructureConfig;
  private watchers: Map<string, ConfigWatcher[]> = new Map();
  private logger: Logger;

  constructor(configPath?: string) {
    this.logger = new Logger('ConfigurationManager');
    this.loadConfiguration(configPath);
    this.setupConfigWatcher();
  }

  getConfig(): SharedInfrastructureConfig {
    return { ...this.config }; // Return immutable copy
  }

  getJobQueueConfig(): JobQueueConfig {
    return this.config.jobQueue;
  }

  getStorageConfig(): StorageConfig {
    return this.config.storage;
  }

  getEventBusConfig(): EventBusConfig {
    return this.config.eventBus;
  }

  // Feature flag support
  isFeatureEnabled(feature: string): boolean {
    return this.config.features?.[feature] ?? false;
  }

  // Dynamic configuration updates
  updateConfig(path: string, value: any): void {
    this.setNestedValue(this.config, path, value);
    this.notifyWatchers(path, value);
    this.validateConfiguration();
  }

  watchConfig(path: string, callback: (newValue: any, oldValue: any) => void): string {
    const watcherId = this.generateWatcherId();
    const watcher: ConfigWatcher = { id: watcherId, callback };

    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    this.watchers.get(path)!.push(watcher);

    return watcherId;
  }

  unwatchConfig(watcherId: string): void {
    for (const [path, watchers] of this.watchers.entries()) {
      const index = watchers.findIndex(w => w.id === watcherId);
      if (index !== -1) {
        watchers.splice(index, 1);
        if (watchers.length === 0) {
          this.watchers.delete(path);
        }
        break;
      }
    }
  }

  private loadConfiguration(configPath?: string): void {
    const path = configPath || process.env.CONFIG_PATH || './config/shared-infrastructure.json';

    try {
      const configData = fs.readFileSync(path, 'utf8');
      this.config = JSON.parse(configData);

      // Environment variable overrides
      this.applyEnvironmentOverrides();

      // Validate configuration
      this.validateConfiguration();

      this.logger.info(`Configuration loaded`, { path, environment: this.config.environment });

    } catch (error) {
      this.logger.error(`Failed to load configuration`, { path, error: error.message });
      throw new ConfigurationError(`Failed to load configuration: ${error.message}`);
    }
  }

  private applyEnvironmentOverrides(): void {
    // Redis configuration
    if (process.env.REDIS_HOST) {
      this.config.jobQueue.redis.host = process.env.REDIS_HOST;
    }
    if (process.env.REDIS_PORT) {
      this.config.jobQueue.redis.port = parseInt(process.env.REDIS_PORT);
    }
    if (process.env.REDIS_PASSWORD) {
      this.config.jobQueue.redis.password = process.env.REDIS_PASSWORD;
    }

    // MinIO configuration
    if (process.env.MINIO_ENDPOINT) {
      this.config.storage.minio.endpoint = process.env.MINIO_ENDPOINT;
    }
    if (process.env.MINIO_ACCESS_KEY) {
      this.config.storage.minio.accessKey = process.env.MINIO_ACCESS_KEY;
    }
    if (process.env.MINIO_SECRET_KEY) {
      this.config.storage.minio.secretKey = process.env.MINIO_SECRET_KEY;
    }

    // Environment-specific overrides
    if (process.env.NODE_ENV) {
      this.config.environment = process.env.NODE_ENV as any;
    }
  }

  private validateConfiguration(): void {
    // Validate required fields
    if (!this.config.jobQueue?.redis?.host) {
      throw new ConfigurationError('Redis host is required');
    }

    if (!this.config.storage?.minio?.endpoint) {
      throw new ConfigurationError('MinIO endpoint is required');
    }

    if (!this.config.eventBus?.websocket?.port) {
      throw new ConfigurationError('WebSocket port is required');
    }

    // Validate numeric values
    if (this.config.jobQueue.redis.port <= 0 || this.config.jobQueue.redis.port > 65535) {
      throw new ConfigurationError('Invalid Redis port');
    }

    // Validate environment-specific settings
    if (this.config.environment === 'production') {
      if (!this.config.security?.encryption?.enabled) {
        this.logger.warn('Encryption is disabled in production environment');
      }

      if (this.config.monitoring?.logging?.level !== 'info' && this.config.monitoring?.logging?.level !== 'warn') {
        this.logger.warn('Debug logging enabled in production environment');
      }
    }
  }

  private setupConfigWatcher(): void {
    if (process.env.ENABLE_CONFIG_WATCH === 'true') {
      // Setup file watcher for configuration changes
      const configPath = process.env.CONFIG_PATH || './config/shared-infrastructure.json';

      fs.watchFile(configPath, (curr, prev) => {
        if (curr.mtime > prev.mtime) {
          this.logger.info('Configuration file changed, reloading...');
          try {
            this.loadConfiguration(configPath);
          } catch (error) {
            this.logger.error('Failed to reload configuration', { error: error.message });
          }
        }
      });
    }
  }

  private notifyWatchers(path: string, newValue: any): void {
    const watchers = this.watchers.get(path);
    if (watchers) {
      const oldValue = this.getNestedValue(this.config, path);
      watchers.forEach(watcher => {
        try {
          watcher.callback(newValue, oldValue);
        } catch (error) {
          this.logger.error('Config watcher callback failed', {
            watcherId: watcher.id,
            path,
            error: error.message
          });
        }
      });
    }
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private generateWatcherId(): string {
    return `watcher_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

interface ConfigWatcher {
  id: string;
  callback: (newValue: any, oldValue: any) => void;
}

class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
```

---

## 5. Error Handling & Resilience

### 5.1 Error Classification & Strategy

```typescript
// Error Categories
enum ErrorCategory {
  TEMPORARY = 'temporary',        // Network issues, temporary unavailability
  RESOURCE = 'resource',          // Memory, disk space, rate limits
  DATA = 'data',                  // Corrupted data, invalid format
  LOGIC = 'logic',                // Programming errors, unexpected states
  SECURITY = 'security',          // Authentication, authorization failures
  CONFIGURATION = 'configuration' // Invalid settings, missing config
}

interface ErrorHandlingStrategy {
  category: ErrorCategory;
  retryable: boolean;
  maxRetries: number;
  backoffStrategy: BackoffStrategy;
  escalationThreshold: number;
  alerting: AlertLevel;
  gracefulDegradation?: DegradationStrategy;
}

interface BackoffStrategy {
  type: 'fixed' | 'exponential' | 'linear';
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

enum AlertLevel {
  NONE = 'none',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical'
}

interface DegradationStrategy {
  enabled: boolean;
  fallbackAction: 'queue' | 'cache' | 'skip' | 'alternate_service';
  timeout: number;
}
```

### 5.2 Resilience Manager Implementation

```typescript
class ResilienceManager {
  private errorStrategies: Map<string, ErrorHandlingStrategy> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private retryPolicies: Map<string, RetryPolicy> = new Map();
  private metrics: MetricsCollector;
  private alertManager: AlertManager;
  private logger: Logger;

  constructor(
    private config: ResilienceConfig,
    alertManager: AlertManager
  ) {
    this.metrics = new MetricsCollector();
    this.alertManager = alertManager;
    this.logger = new Logger('ResilienceManager');

    this.initializeErrorStrategies();
    this.initializeCircuitBreakers();
    this.initializeRetryPolicies();
  }

  // Main error handling entry point
  async handleError(
    error: Error,
    context: ErrorContext
  ): Promise<ErrorHandlingResult> {
    const startTime = Date.now();

    try {
      // Classify error
      const category = this.classifyError(error);
      const strategy = this.getErrorStrategy(category, context);

      // Record error metrics
      this.recordErrorMetrics(error, category, context);

      // Determine if retryable
      if (!strategy.retryable || context.attemptCount >= strategy.maxRetries) {
        return this.handleNonRetryableError(error, category, context);
      }

      // Check circuit breaker
      const circuitBreaker = this.getCircuitBreaker(context.service);
      if (!circuitBreaker.canExecute()) {
        return this.handleCircuitBreakerOpen(error, context);
      }

      // Calculate retry delay
      const retryDelay = this.calculateRetryDelay(strategy, context.attemptCount);

      // Log error
      this.logger.error(`Error occurred, will retry`, {
        error: error.message,
        category,
        service: context.service,
        attemptCount: context.attemptCount,
        maxRetries: strategy.maxRetries,
        retryDelay,
        traceId: context.traceId
      });

      // Check if escalation is needed
      if (context.attemptCount >= strategy.escalationThreshold) {
        await this.escalateError(error, category, context);
      }

      return {
        action: 'retry',
        delay: retryDelay,
        newAttemptCount: context.attemptCount + 1,
        strategy: strategy
      };

    } catch (handlingError) {
      this.logger.error(`Error in error handling`, {
        originalError: error.message,
        handlingError: handlingError.message,
        context
      });

      return {
        action: 'fail',
        delay: 0,
        newAttemptCount: context.attemptCount,
        error: handlingError
      };
    } finally {
      this.metrics.recordHistogram(
        'error_handling_duration_ms',
        Date.now() - startTime,
        { category: this.classifyError(error) }
      );
    }
  }

  // Circuit breaker management
  recordSuccess(service: string): void {
    const circuitBreaker = this.getCircuitBreaker(service);
    circuitBreaker.recordSuccess();
  }

  recordFailure(service: string, error: Error): void {
    const circuitBreaker = this.getCircuitBreaker(service);
    circuitBreaker.recordFailure();

    // Update metrics
    this.metrics.incrementCounter('circuit_breaker_failures_total', {
      service,
      error_type: error.constructor.name
    });
  }

  private classifyError(error: Error): ErrorCategory {
    // Network and connectivity errors
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('timeout')) {
      return ErrorCategory.TEMPORARY;
    }

    // Resource exhaustion
    if (error.message.includes('ENOMEM') ||
        error.message.includes('ENOSPC') ||
        error.message.includes('rate limit')) {
      return ErrorCategory.RESOURCE;
    }

    // Data validation errors
    if (error.name === 'ValidationError' ||
        error.message.includes('invalid format') ||
        error.message.includes('corrupted')) {
      return ErrorCategory.DATA;
    }

    // Security errors
    if (error.name === 'UnauthorizedError' ||
        error.name === 'ForbiddenError' ||
        error.message.includes('authentication')) {
      return ErrorCategory.SECURITY;
    }

    // Configuration errors
    if (error.name === 'ConfigurationError' ||
        error.message.includes('configuration') ||
        error.message.includes('not configured')) {
      return ErrorCategory.CONFIGURATION;
    }

    // Default to logic error
    return ErrorCategory.LOGIC;
  }

  private getErrorStrategy(
    category: ErrorCategory,
    context: ErrorContext
  ): ErrorHandlingStrategy {
    const key = `${category}:${context.service}`;
    return this.errorStrategies.get(key) || this.errorStrategies.get(category) || {
      category,
      retryable: false,
      maxRetries: 0,
      backoffStrategy: { type: 'fixed', baseDelay: 1000, maxDelay: 5000, jitter: false },
      escalationThreshold: 1,
      alerting: AlertLevel.ERROR
    };
  }

  private calculateRetryDelay(strategy: ErrorHandlingStrategy, attemptCount: number): number {
    const { backoffStrategy } = strategy;
    let delay: number;

    switch (backoffStrategy.type) {
      case 'fixed':
        delay = backoffStrategy.baseDelay;
        break;
      case 'exponential':
        delay = Math.min(
          backoffStrategy.baseDelay * Math.pow(2, attemptCount - 1),
          backoffStrategy.maxDelay
        );
        break;
      case 'linear':
        delay = Math.min(
          backoffStrategy.baseDelay * attemptCount,
          backoffStrategy.maxDelay
        );
        break;
      default:
        delay = backoffStrategy.baseDelay;
    }

    // Add jitter if enabled
    if (backoffStrategy.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay += (Math.random() - 0.5) * 2 * jitterAmount;
    }

    return Math.max(delay, 100); // Minimum 100ms delay
  }

  private async handleNonRetryableError(
    error: Error,
    category: ErrorCategory,
    context: ErrorContext
  ): Promise<ErrorHandlingResult> {
    // Log permanent failure
    this.logger.error(`Permanent error occurred`, {
      error: error.message,
      category,
      service: context.service,
      traceId: context.traceId
    });

    // Record failure metrics
    this.metrics.incrementCounter('permanent_failures_total', {
      category,
      service: context.service,
      error_type: error.constructor.name
    });

    // Send alert if configured
    const strategy = this.getErrorStrategy(category, context);
    if (strategy.alerting !== AlertLevel.NONE) {
      await this.alertManager.sendAlert({
        level: strategy.alerting,
        title: `Permanent failure in ${context.service}`,
        message: `Error: ${error.message}`,
        context: {
          service: context.service,
          category,
          traceId: context.traceId
        }
      });
    }

    return {
      action: 'fail',
      delay: 0,
      newAttemptCount: context.attemptCount,
      error: error
    };
  }

  private async escalateError(
    error: Error,
    category: ErrorCategory,
    context: ErrorContext
  ): Promise<void> {
    this.logger.warn(`Escalating error`, {
      error: error.message,
      category,
      service: context.service,
      attemptCount: context.attemptCount,
      traceId: context.traceId
    });

    await this.alertManager.sendAlert({
      level: AlertLevel.WARN,
      title: `Repeated failures in ${context.service}`,
      message: `Error has occurred ${context.attemptCount} times: ${error.message}`,
      context: {
        service: context.service,
        category,
        attemptCount: context.attemptCount,
        traceId: context.traceId
      }
    });
  }

  private getCircuitBreaker(service: string): CircuitBreaker {
    if (!this.circuitBreakers.has(service)) {
      const config = this.config.circuitBreakers[service] || this.config.circuitBreakers.default;
      this.circuitBreakers.set(service, new CircuitBreaker(config));
    }
    return this.circuitBreakers.get(service)!;
  }

  private initializeErrorStrategies(): void {
    // Temporary errors - retryable
    this.errorStrategies.set(ErrorCategory.TEMPORARY, {
      category: ErrorCategory.TEMPORARY,
      retryable: true,
      maxRetries: 3,
      backoffStrategy: { type: 'exponential', baseDelay: 1000, maxDelay: 10000, jitter: true },
      escalationThreshold: 2,
      alerting: AlertLevel.WARN
    });

    // Resource errors - retryable with longer delays
    this.errorStrategies.set(ErrorCategory.RESOURCE, {
      category: ErrorCategory.RESOURCE,
      retryable: true,
      maxRetries: 5,
      backoffStrategy: { type: 'exponential', baseDelay: 5000, maxDelay: 60000, jitter: true },
      escalationThreshold: 3,
      alerting: AlertLevel.ERROR,
      gracefulDegradation: { enabled: true, fallbackAction: 'queue', timeout: 30000 }
    });

    // Data errors - not retryable
    this.errorStrategies.set(ErrorCategory.DATA, {
      category: ErrorCategory.DATA,
      retryable: false,
      maxRetries: 0,
      backoffStrategy: { type: 'fixed', baseDelay: 0, maxDelay: 0, jitter: false },
      escalationThreshold: 1,
      alerting: AlertLevel.ERROR
    });

    // Logic errors - not retryable, high priority alert
    this.errorStrategies.set(ErrorCategory.LOGIC, {
      category: ErrorCategory.LOGIC,
      retryable: false,
      maxRetries: 0,
      backoffStrategy: { type: 'fixed', baseDelay: 0, maxDelay: 0, jitter: false },
      escalationThreshold: 1,
      alerting: AlertLevel.CRITICAL
    });
  }
}

interface ErrorContext {
  service: string;
  operation: string;
  attemptCount: number;
  traceId: string;
  metadata?: Record<string, any>;
}

interface ErrorHandlingResult {
  action: 'retry' | 'fail' | 'degrade';
  delay: number;
  newAttemptCount: number;
  strategy?: ErrorHandlingStrategy;
  error?: Error;
}
```

### 5.3 Circuit Breaker Implementation

```typescript
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private nextAttempt: number = 0;
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(private config: CircuitBreakerConfig) {
    this.metrics = new MetricsCollector();
    this.logger = new Logger('CircuitBreaker');
  }

  canExecute(): boolean {
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (Date.now() >= this.nextAttempt) {
          this.state = CircuitBreakerState.HALF_OPEN;
          this.logger.info(`Circuit breaker transitioning to HALF_OPEN`);
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.successes++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitBreakerState.CLOSED;
        this.successes = 0;
        this.logger.info(`Circuit breaker transitioned to CLOSED`);
      }
    }

    this.metrics.incrementCounter('circuit_breaker_successes_total');
  }

  recordFailure(): void {
    this.failures++;
    this.successes = 0;

    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.nextAttempt = Date.now() + this.config.timeout;
      this.logger.warn(`Circuit breaker opened due to ${this.failures} failures`);

      this.metrics.incrementCounter('circuit_breaker_opened_total');
    }

    this.metrics.incrementCounter('circuit_breaker_failures_total');
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.nextAttempt
    };
  }
}

enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}

interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  nextAttempt: number;
}
```

---

## 6. Security & Access Control

### 6.1 Security Manager

```typescript
interface SecurityManager {
  // Authentication
  validateToken(token: string): Promise<AuthResult>;
  generateToken(claims: TokenClaims): Promise<string>;
  refreshToken(refreshToken: string): Promise<TokenPair>;

  // Authorization
  checkPermission(user: User, resource: string, action: string): Promise<boolean>;
  getRolePermissions(role: string): Promise<Permission[]>;

  // Job Security
  validateJobData(queueName: string, jobName: string, data: any): Promise<void>;
  validateJobExecution(job: Job): Promise<void>;

  // Data Protection
  encryptSensitiveData(data: any): Promise<string>;
  decryptSensitiveData(encryptedData: string): Promise<any>;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;

  // Rate Limiting
  checkRateLimit(key: string, limit: RateLimit): Promise<RateLimitResult>;

  // Audit
  logSecurityEvent(event: SecurityEvent): Promise<void>;
}

interface AuthResult {
  valid: boolean;
  user?: User;
  claims?: TokenClaims;
  error?: string;
}

interface TokenClaims {
  sub: string;           // Subject (user ID)
  iat: number;          // Issued at
  exp: number;          // Expires at
  scope: string[];      // Permissions
  clientId?: string;    // Client application ID
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RateLimit {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (context: any) => string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}
```

### 6.2 Security Manager Implementation

```typescript
class SecurityManagerImpl implements SecurityManager {
  private jwtSecret: string;
  private encryptionKey: string;
  private rateLimiter: Map<string, RateLimiterMemory> = new Map();
  private auditLogger: AuditLogger;
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(private config: SecurityConfig) {
    this.jwtSecret = config.jwt.secret;
    this.encryptionKey = config.encryption.key;
    this.auditLogger = new AuditLogger(config.audit);
    this.metrics = new MetricsCollector();
    this.logger = new Logger('SecurityManager');
  }

  async validateToken(token: string): Promise<AuthResult> {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as TokenClaims;

      // Check if token is expired
      if (payload.exp < Date.now() / 1000) {
        return { valid: false, error: 'Token expired' };
      }

      // Load user information
      const user = await this.loadUser(payload.sub);
      if (!user) {
        return { valid: false, error: 'User not found' };
      }

      this.metrics.incrementCounter('token_validations_total', { result: 'success' });

      return {
        valid: true,
        user,
        claims: payload
      };

    } catch (error) {
      this.metrics.incrementCounter('token_validations_total', { result: 'failed' });

      return {
        valid: false,
        error: error.message
      };
    }
  }

  async generateToken(claims: TokenClaims): Promise<string> {
    const payload = {
      ...claims,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.config.jwt.expiresIn
    };

    const token = jwt.sign(payload, this.jwtSecret);

    await this.auditLogger.log({
      type: 'token_generated',
      userId: claims.sub,
      clientId: claims.clientId,
      timestamp: new Date().toISOString()
    });

    return token;
  }

  async checkPermission(user: User, resource: string, action: string): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(user);

    const hasPermission = userPermissions.some(permission =>
      this.matchesPermission(permission, resource, action)
    );

    await this.auditLogger.log({
      type: 'permission_check',
      userId: user.id,
      resource,
      action,
      result: hasPermission ? 'granted' : 'denied',
      timestamp: new Date().toISOString()
    });

    return hasPermission;
  }

  async validateJobData(queueName: string, jobName: string, data: any): Promise<void> {
    // Input sanitization
    if (typeof data !== 'object' || data === null) {
      throw new SecurityError('Invalid job data format');
    }

    // Check for malicious payloads
    const serialized = JSON.stringify(data);
    if (this.containsMaliciousContent(serialized)) {
      await this.auditLogger.log({
        type: 'malicious_job_data_detected',
        queueName,
        jobName,
        timestamp: new Date().toISOString()
      });

      throw new SecurityError('Malicious content detected in job data');
    }

    // Size limits
    if (serialized.length > this.config.job.maxDataSize) {
      throw new SecurityError('Job data exceeds maximum size limit');
    }

    // Queue-specific validation
    await this.validateQueueSpecificData(queueName, jobName, data);
  }

  async checkRateLimit(key: string, limit: RateLimit): Promise<RateLimitResult> {
    let limiter = this.rateLimiter.get(key);

    if (!limiter) {
      limiter = new RateLimiterMemory({
        points: limit.maxRequests,
        duration: limit.windowMs / 1000
      });
      this.rateLimiter.set(key, limiter);
    }

    try {
      const result = await limiter.consume(key);

      return {
        allowed: true,
        remaining: result.remainingHits || 0,
        resetTime: new Date(Date.now() + result.msBeforeNext).getTime()
      };

    } catch (rateLimitError) {
      this.metrics.incrementCounter('rate_limit_exceeded_total', { key });

      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(Date.now() + rateLimitError.msBeforeNext).getTime(),
        retryAfter: rateLimitError.msBeforeNext
      };
    }
  }

  async encryptSensitiveData(data: any): Promise<string> {
    const jsonString = JSON.stringify(data);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(jsonString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  async decryptSensitiveData(encryptedData: string): Promise<any> {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  private containsMaliciousContent(content: string): boolean {
    const maliciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /Function\s*\(/gi
    ];

    return maliciousPatterns.some(pattern => pattern.test(content));
  }

  private async validateQueueSpecificData(queueName: string, jobName: string, data: any): Promise<void> {
    switch (queueName) {
      case 'photo-processing':
        if (!data.photoId || !data.storage || !data.pipeline) {
          throw new SecurityError('Missing required fields for photo processing job');
        }

        // Validate storage references
        if (!this.isValidS3Key(data.storage.s3Key)) {
          throw new SecurityError('Invalid S3 key format');
        }
        break;
    }
  }

  private isValidS3Key(key: string): boolean {
    // S3 key validation: no path traversal, valid characters
    return /^[a-zA-Z0-9._-]+$/.test(key) && !key.includes('..');
  }
}
```

---

## 7. Monitoring & Observability

### 7.1 Metrics Collection

```typescript
interface MetricsCollector {
  // Counters
  incrementCounter(name: string, labels?: Record<string, string>): void;
  decrementCounter(name: string, labels?: Record<string, string>): void;

  // Gauges
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  incrementGauge(name: string, labels?: Record<string, string>): void;
  decrementGauge(name: string, labels?: Record<string, string>): void;

  // Histograms
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;

  // Custom metrics
  recordCustomMetric(metric: CustomMetric): void;

  // Export
  getMetrics(): Promise<MetricsSnapshot>;
  exportPrometheus(): Promise<string>;
}

interface CustomMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

interface MetricsSnapshot {
  timestamp: number;
  counters: Record<string, MetricValue>;
  gauges: Record<string, MetricValue>;
  histograms: Record<string, HistogramValue>;
}

interface MetricValue {
  value: number;
  labels: Record<string, string>;
}

interface HistogramValue extends MetricValue {
  buckets: Record<string, number>;
  count: number;
  sum: number;
}
```

### 7.2 Health Check System

```typescript
interface HealthCheckService {
  registerCheck(name: string, check: HealthCheck): void;
  unregisterCheck(name: string): void;
  runCheck(name: string): Promise<HealthCheckResult>;
  runAllChecks(): Promise<HealthCheckSummary>;
  getHealthStatus(): Promise<OverallHealthStatus>;
}

interface HealthCheck {
  name: string;
  timeout: number;
  interval: number;
  execute(): Promise<HealthCheckResult>;
}

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  duration: number;
  timestamp: string;
  metadata?: Record<string, any>;
}

interface HealthCheckSummary {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  timestamp: string;
}

class HealthCheckServiceImpl implements HealthCheckService {
  private checks: Map<string, HealthCheck> = new Map();
  private results: Map<string, HealthCheckResult> = new Map();
  private intervals: Map<string, NodeJS.Timer> = new Map();
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor() {
    this.metrics = new MetricsCollector();
    this.logger = new Logger('HealthCheckService');
    this.registerDefaultChecks();
  }

  registerCheck(name: string, check: HealthCheck): void {
    this.checks.set(name, check);

    // Schedule periodic execution
    const interval = setInterval(async () => {
      try {
        await this.runCheck(name);
      } catch (error) {
        this.logger.error(`Health check ${name} failed`, { error: error.message });
      }
    }, check.interval);

    this.intervals.set(name, interval);

    this.logger.info(`Health check registered`, { name, interval: check.interval });
  }

  async runCheck(name: string): Promise<HealthCheckResult> {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check '${name}' not found`);
    }

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        check.execute(),
        this.createTimeoutPromise(check.timeout)
      ]);

      result.duration = Date.now() - startTime;
      result.timestamp = new Date().toISOString();

      this.results.set(name, result);

      // Record metrics
      this.metrics.incrementCounter('health_checks_total', {
        name,
        status: result.status
      });

      this.metrics.recordHistogram('health_check_duration_ms', result.duration, { name });

      return result;

    } catch (error) {
      const result: HealthCheckResult = {
        name,
        status: 'unhealthy',
        message: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.results.set(name, result);

      this.metrics.incrementCounter('health_checks_total', {
        name,
        status: 'unhealthy'
      });

      return result;
    }
  }

  async runAllChecks(): Promise<HealthCheckSummary> {
    const checkPromises = Array.from(this.checks.keys()).map(name =>
      this.runCheck(name)
    );

    const results = await Promise.all(checkPromises);

    const overall = this.determineOverallHealth(results);

    return {
      overall,
      checks: results,
      timestamp: new Date().toISOString()
    };
  }

  private registerDefaultChecks(): void {
    // Redis connectivity check
    this.registerCheck('redis', {
      name: 'redis',
      timeout: 5000,
      interval: 30000,
      execute: async () => {
        const redis = new Redis(/* config */);
        try {
          await redis.ping();
          await redis.disconnect();
          return {
            name: 'redis',
            status: 'healthy',
            message: 'Redis connection successful',
            duration: 0,
            timestamp: ''
          };
        } catch (error) {
          throw error;
        }
      }
    });

    // MinIO connectivity check
    this.registerCheck('minio', {
      name: 'minio',
      timeout: 10000,
      interval: 60000,
      execute: async () => {
        // MinIO health check implementation
        return {
          name: 'minio',
          status: 'healthy',
          message: 'MinIO connection successful',
          duration: 0,
          timestamp: ''
        };
      }
    });

    // System resources check
    this.registerCheck('system_resources', {
      name: 'system_resources',
      timeout: 5000,
      interval: 30000,
      execute: async () => {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

        if (memoryUsagePercent > 90) {
          return {
            name: 'system_resources',
            status: 'unhealthy',
            message: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`,
            duration: 0,
            timestamp: '',
            metadata: { memoryUsage, cpuUsage }
          };
        }

        if (memoryUsagePercent > 70) {
          return {
            name: 'system_resources',
            status: 'degraded',
            message: `Moderate memory usage: ${memoryUsagePercent.toFixed(1)}%`,
            duration: 0,
            timestamp: '',
            metadata: { memoryUsage, cpuUsage }
          };
        }

        return {
          name: 'system_resources',
          status: 'healthy',
          message: `Memory usage: ${memoryUsagePercent.toFixed(1)}%`,
          duration: 0,
          timestamp: '',
          metadata: { memoryUsage, cpuUsage }
        };
      }
    });
  }

  private determineOverallHealth(results: HealthCheckResult[]): 'healthy' | 'unhealthy' | 'degraded' {
    if (results.some(r => r.status === 'unhealthy')) {
      return 'unhealthy';
    }

    if (results.some(r => r.status === 'degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timed out after ${timeout}ms`));
      }, timeout);
    });
  }
}
```

---

## 8. Deployment & Operations

### 8.1 Docker Configuration

```yaml
# docker-compose.yml for Shared Infrastructure
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  shared-infrastructure:
    build:
      context: .
      dockerfile: Dockerfile.shared-infrastructure
    ports:
      - "3001:3001"  # Event Bus WebSocket
      - "3002:3002"  # Health Check API
      - "3003:3003"  # Metrics API
    environment:
      NODE_ENV: production
      REDIS_HOST: redis
      REDIS_PORT: 6379
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin123
      SQLITE_PATH: /data/metadata.db
    volumes:
      - shared_data:/data
      - ./config:/app/config:ro
    depends_on:
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  redis_data:
  minio_data:
  shared_data:
```

### 8.2 Kubernetes Configuration

```yaml
# kubernetes/shared-infrastructure-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shared-infrastructure
  labels:
    app: shared-infrastructure
    component: infrastructure
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shared-infrastructure
  template:
    metadata:
      labels:
        app: shared-infrastructure
    spec:
      containers:
      - name: shared-infrastructure
        image: photo-management/shared-infrastructure:latest
        ports:
        - containerPort: 3001
          name: websocket
        - containerPort: 3002
          name: health
        - containerPort: 3003
          name: metrics
        env:
        - name: NODE_ENV
          value: "production"
        - name: REDIS_HOST
          value: "redis-service"
        - name: MINIO_ENDPOINT
          value: "minio-service"
        - name: SQLITE_PATH
          value: "/data/metadata.db"
        volumeMounts:
        - name: shared-data
          mountPath: /data
        - name: config-volume
          mountPath: /app/config
          readOnly: true
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3002
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3002
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: shared-data
        persistentVolumeClaim:
          claimName: shared-data-pvc
      - name: config-volume
        configMap:
          name: shared-infrastructure-config
```

---

## 9. Performance & Scaling

### 9.1 Scaling Strategies

```typescript
interface ScalingManager {
  getResourceMetrics(): Promise<ResourceMetrics>;
  scaleComponent(component: string, targetReplicas: number): Promise<ScalingResult>;
  getScalingRecommendations(): Promise<ScalingRecommendation[]>;
  enableAutoScaling(component: string, policy: AutoScalingPolicy): Promise<void>;
  disableAutoScaling(component: string): Promise<void>;
}

interface ResourceMetrics {
  cpu: ResourceUsage;
  memory: ResourceUsage;
  network: NetworkMetrics;
  storage: StorageMetrics;
  queues: QueueMetrics[];
}

interface ResourceUsage {
  current: number;
  average: number;
  peak: number;
  unit: string;
}

interface AutoScalingPolicy {
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilization: number;
  targetMemoryUtilization: number;
  scaleUpCooldown: number;
  scaleDownCooldown: number;
}

interface ScalingRecommendation {
  component: string;
  currentReplicas: number;
  recommendedReplicas: number;
  reason: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
}
```

### 9.2 Performance Optimization

```typescript
class PerformanceOptimizer {
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor() {
    this.metrics = new MetricsCollector();
    this.logger = new Logger('PerformanceOptimizer');
  }

  async optimizeJobQueue(queueName: string): Promise<OptimizationResult> {
    const queueMetrics = await this.getQueueMetrics(queueName);
    const recommendations: OptimizationRecommendation[] = [];

    // Analyze queue depth
    if (queueMetrics.waiting > 1000) {
      recommendations.push({
        type: 'scale_workers',
        priority: 'high',
        description: 'Queue depth is high, consider scaling workers',
        impact: 'Reduce processing latency'
      });
    }

    // Analyze processing times
    if (queueMetrics.averageProcessingTime > 30000) {
      recommendations.push({
        type: 'optimize_pipeline',
        priority: 'medium',
        description: 'Processing times are high, review pipeline efficiency',
        impact: 'Improve throughput'
      });
    }

    // Analyze failure rate
    if (queueMetrics.failureRate > 0.1) {
      recommendations.push({
        type: 'improve_reliability',
        priority: 'high',
        description: 'High failure rate detected, review error handling',
        impact: 'Reduce retry overhead'
      });
    }

    return {
      queueName,
      currentPerformance: this.calculatePerformanceScore(queueMetrics),
      recommendations,
      estimatedImprovement: this.estimateImprovement(recommendations)
    };
  }

  async optimizeStorage(): Promise<StorageOptimizationResult> {
    const storageMetrics = await this.getStorageMetrics();
    const recommendations: StorageRecommendation[] = [];

    // Check for orphaned objects
    if (storageMetrics.orphanedObjects > 100) {
      recommendations.push({
        type: 'cleanup_orphans',
        description: `${storageMetrics.orphanedObjects} orphaned objects found`,
        estimatedSavings: `${storageMetrics.orphanedObjectsSize} MB`
      });
    }

    // Check bucket distribution
    const bucketDistribution = this.analyzeBucketDistribution(storageMetrics);
    if (bucketDistribution.imbalanced) {
      recommendations.push({
        type: 'rebalance_buckets',
        description: 'Uneven bucket distribution detected',
        estimatedSavings: '10-20% performance improvement'
      });
    }

    return {
      currentUsage: storageMetrics,
      recommendations,
      potentialSavings: this.calculatePotentialSavings(recommendations)
    };
  }

  private calculatePerformanceScore(metrics: QueueMetrics): number {
    // Performance scoring algorithm
    const depthScore = Math.max(0, 100 - (metrics.waiting / 10));
    const speedScore = Math.max(0, 100 - (metrics.averageProcessingTime / 300));
    const reliabilityScore = Math.max(0, 100 - (metrics.failureRate * 100));

    return (depthScore + speedScore + reliabilityScore) / 3;
  }
}

interface OptimizationRecommendation {
  type: string;
  priority: 'low' | 'medium' | 'high';
  description: string;
  impact: string;
}

interface StorageRecommendation {
  type: string;
  description: string;
  estimatedSavings: string;
}
```

---

## 10. Implementation Guidelines

### 10.1 Development Setup

```bash
#!/bin/bash
# scripts/setup-dev-environment.sh

echo "Setting up shared infrastructure development environment..."

# Install dependencies
npm install

# Setup local Redis
docker run -d --name redis-dev -p 6379:6379 redis:7-alpine

# Setup local MinIO
docker run -d \
  --name minio-dev \
  -p 9000:9000 -p 9001:9001 \
  -e "MINIO_ACCESS_KEY=minioadmin" \
  -e "MINIO_SECRET_KEY=minioadmin123" \
  minio/minio server /data --console-address ":9001"

# Create SQLite database
mkdir -p data
sqlite3 data/metadata.db < sql/schema.sql

# Copy configuration templates
cp config/development.template.json config/development.json

echo "Development environment setup complete!"
echo "Redis: localhost:6379"
echo "MinIO: http://localhost:9000 (admin/minioadmin123)"
echo "MinIO Console: http://localhost:9001"
```

### 10.2 Database Schema

```sql
-- sql/schema.sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  s3_key TEXT NOT NULL,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS thumbnails (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  size_name TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  s3_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS processing_logs (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  duration_ms INTEGER,
  error_details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_photos_client_id ON photos(client_id);
CREATE INDEX idx_photos_session_id ON photos(session_id);
CREATE INDEX idx_photos_processing_status ON photos(processing_status);
CREATE INDEX idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX idx_thumbnails_photo_id ON thumbnails(photo_id);
CREATE INDEX idx_processing_logs_photo_id ON processing_logs(photo_id);
CREATE INDEX idx_processing_logs_job_id ON processing_logs(job_id);
```

### 10.3 Configuration Templates

```json
// config/development.template.json
{
  "environment": "development",
  "version": "1.0.0",

  "jobQueue": {
    "redis": {
      "host": "localhost",
      "port": 6379,
      "db": 0,
      "keyPrefix": "photo-management:dev:"
    },
    "defaultJobOptions": {
      "attempts": 3,
      "backoff": {
        "type": "exponential",
        "delay": 1000,
        "maxDelay": 10000
      },
      "removeOnComplete": 100,
      "removeOnFail": 50,
      "priority": 5
    },
    "queues": {
      "photo-processing": {
        "name": "photo-processing",
        "concurrency": 2,
        "settings": {
          "stalledInterval": 30000,
          "retryProcessDelay": 5000,
          "maxStalledCount": 1
        }
      }
    }
  },

  "storage": {
    "minio": {
      "endpoint": "localhost",
      "port": 9000,
      "useSSL": false,
      "accessKey": "minioadmin",
      "secretKey": "minioadmin123",
      "buckets": [
        {
          "name": "images",
          "versioning": false,
          "encryption": false
        },
        {
          "name": "images-large",
          "versioning": false,
          "encryption": false
        },
        {
          "name": "thumbnails",
          "versioning": false,
          "encryption": false
        }
      ]
    },
    "sqlite": {
      "path": "./data/metadata.db",
      "options": {
        "verbose": true
      }
    },
    "consistency": {
      "enabled": true,
      "checkInterval": 3600000,
      "autoCleanup": false
    }
  },

  "eventBus": {
    "redis": {
      "host": "localhost",
      "port": 6379,
      "db": 1
    },
    "websocket": {
      "port": 3001,
      "corsOrigins": ["http://localhost:3000"],
      "pingTimeout": 60000,
      "pingInterval": 25000,
      "transports": ["websocket", "polling"]
    },
    "filters": [],
    "routing": {
      "defaultRoom": "general",
      "roomExpiry": 3600000
    }
  },

  "security": {
    "jwt": {
      "secret": "dev-secret-key-change-in-production",
      "expiresIn": 3600
    },
    "encryption": {
      "enabled": false,
      "key": "dev-encryption-key"
    },
    "rateLimit": {
      "enabled": true,
      "windowMs": 900000,
      "maxRequests": 1000
    }
  },

  "monitoring": {
    "metrics": {
      "enabled": true,
      "port": 3003,
      "endpoint": "/metrics"
    },
    "logging": {
      "level": "debug",
      "format": "json",
      "outputs": ["console"]
    },
    "tracing": {
      "enabled": false,
      "serviceName": "shared-infrastructure",
      "jaegerEndpoint": "http://localhost:14268/api/traces"
    },
    "healthCheck": {
      "enabled": true,
      "port": 3002,
      "endpoint": "/health"
    }
  },

  "features": {
    "autoScaling": false,
    "consistencyChecks": true,
    "performanceOptimization": true,
    "auditLogging": true
  }
}
```

### 10.4 Testing Strategy

```typescript
// tests/integration/shared-infrastructure.test.ts
describe('Shared Infrastructure Integration Tests', () => {
  let jobQueueCoordinator: JobQueueCoordinator;
  let storageCoordinator: StorageCoordinator;
  let eventBusService: EventBusService;
  let testConfig: SharedInfrastructureConfig;

  beforeAll(async () => {
    // Setup test environment
    testConfig = await loadTestConfig();

    jobQueueCoordinator = new JobQueueCoordinatorImpl(testConfig);
    storageCoordinator = new StorageCoordinatorImpl(testConfig.storage);
    eventBusService = new EventBusServiceImpl(testConfig.eventBus);

    // Wait for services to be ready
    await Promise.all([
      jobQueueCoordinator.initialize(),
      storageCoordinator.initialize(),
      eventBusService.initialize()
    ]);
  });

  describe('Job Queue Coordination', () => {
    test('should enqueue and process photo processing job', async () => {
      const jobData: PhotoProcessingJob = {
        id: 'test-job-1',
        photoId: 'test-photo-1',
        storage: {
          s3Key: 'test/photo-1.jpg',
          bucket: 'test-images',
          originalSize: 1024000,
          mimeType: 'image/jpeg'
        },
        pipeline: {
          name: 'test_processing',
          stages: ['validation', 'thumbnails'],
          priority: 5
        },
        context: {
          clientId: 'test-client',
          uploadedAt: new Date().toISOString(),
          traceId: 'test-trace-1'
        },
        metadata: {
          fileSize: 1024000
        }
      };

      // Enqueue job
      const job = await jobQueueCoordinator.enqueueJob(
        'photo-processing',
        'process-photo',
        jobData
      );

      expect(job.id).toBeDefined();
      expect(job.data).toEqual(jobData);

      // Create worker to process job
      const processedJobs: Job[] = [];
      const worker = jobQueueCoordinator.createWorker(
        'photo-processing',
        async (job) => {
          processedJobs.push(job);
          return { success: true, duration: 1000 };
        }
      );

      // Wait for job to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(processedJobs).toHaveLength(1);
      expect(processedJobs[0].data).toEqual(jobData);

      await worker.close();
    });
  });

  describe('Storage Coordination', () => {
    test('should store and retrieve blob', async () => {
      const testData = Buffer.from('test image data');
      const metadata: BlobMetadata = {
        contentType: 'image/jpeg',
        contentLength: testData.length
      };

      // Store blob
      const result = await storageCoordinator.storeBlob(
        'test-blob-1',
        testData,
        metadata
      );

      expect(result.key).toBe('test-blob-1');
      expect(result.size).toBe(testData.length);

      // Retrieve blob
      const retrievedData = await storageCoordinator.fetchBlob('test-blob-1');

      expect(retrievedData).toEqual(testData);

      // Cleanup
      await storageCoordinator.deleteBlob('test-blob-1');
    });

    test('should handle database transactions', async () => {
      const transaction = await storageCoordinator.beginTransaction();

      try {
        // Create photo record
        const photoId = await transaction.createRecord('photos', {
          s3_key: 'test-transaction-photo.jpg',
          s3_url: 'http://localhost:9000/test/photo.jpg',
          bucket: 'test',
          file_size: 100000,
          mime_type: 'image/jpeg',
          original_filename: 'photo.jpg',
          client_id: 'test-client',
          processing_status: 'queued',
          uploaded_at: new Date().toISOString()
        });

        // Create thumbnail record
        await transaction.createRecord('thumbnails', {
          photo_id: photoId,
          size_name: 'small',
          s3_key: 'test-thumbnail.jpg',
          s3_url: 'http://localhost:9000/test/thumbnail.jpg',
          bucket: 'thumbnails',
          width: 150,
          height: 150,
          file_size: 10000
        });

        await transaction.commit();

        // Verify records exist
        const photo = await storageCoordinator.getRecord('photos', photoId);
        expect(photo).toBeDefined();
        expect(photo.s3_key).toBe('test-transaction-photo.jpg');

      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  });

  describe('Event Bus Service', () => {
    test('should publish and receive events', async () => {
      const receivedEvents: Event[] = [];

      // Subscribe to channel
      await eventBusService.subscribe('test:events', (event) => {
        receivedEvents.push(event);
      });

      // Publish event
      const testEvent: Event = {
        id: 'test-event-1',
        type: 'test.event',
        data: { message: 'Hello, World!' },
        metadata: {
          source: 'test',
          traceId: 'test-trace-1',
          version: '1.0.0'
        },
        timestamp: new Date().toISOString()
      };

      await eventBusService.publishEvent('test:events', testEvent);

      // Wait for event to be received
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(testEvent);
    });
  });

  describe('End-to-End Workflow', () => {
    test('should handle complete photo processing workflow', async () => {
      const events: Event[] = [];

      // Subscribe to all photo events
      await eventBusService.subscribe('photo:*', (event) => {
        events.push(event);
      });

      // 1. Store photo blob
      const photoData = Buffer.from('fake image data');
      const storageResult = await storageCoordinator.storeBlob(
        'e2e-test-photo.jpg',
        photoData,
        { contentType: 'image/jpeg' }
      );

      // 2. Create photo metadata record
      const photoId = await storageCoordinator.createRecord('photos', {
        s3_key: storageResult.key,
        s3_url: storageResult.url,
        bucket: storageResult.bucket,
        file_size: photoData.length,
        mime_type: 'image/jpeg',
        original_filename: 'test-photo.jpg',
        client_id: 'e2e-test-client',
        processing_status: 'queued',
        uploaded_at: new Date().toISOString()
      });

      // 3. Publish upload event
      await eventBusService.publishEvent('photo:upload', {
        id: 'upload-event-1',
        type: 'photo.uploaded',
        data: {
          photoId,
          s3Url: storageResult.url,
          fileSize: photoData.length,
          mimeType: 'image/jpeg'
        },
        metadata: {
          source: 'api-gateway',
          clientId: 'e2e-test-client',
          version: '1.0.0'
        },
        timestamp: new Date().toISOString()
      });

      // 4. Enqueue processing job
      const job = await jobQueueCoordinator.enqueueJob('photo-processing', 'process-photo', {
        id: 'e2e-job-1',
        photoId,
        storage: {
          s3Key: storageResult.key,
          bucket: storageResult.bucket,
          originalSize: photoData.length,
          mimeType: 'image/jpeg'
        },
        pipeline: {
          name: 'e2e_processing',
          stages: ['validation', 'thumbnails'],
          priority: 5
        },
        context: {
          clientId: 'e2e-test-client',
          uploadedAt: new Date().toISOString(),
          traceId: 'e2e-test-trace'
        },
        metadata: {
          fileSize: photoData.length
        }
      });

      // 5. Process job
      const worker = jobQueueCoordinator.createWorker('photo-processing', async (job) => {
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, 100));

        // Update photo status
        await storageCoordinator.updateRecord('photos', photoId, {
          processing_status: 'completed',
          processing_completed_at: new Date().toISOString()
        });

        // Publish completion event
        await eventBusService.publishEvent('photo:completion', {
          id: 'completion-event-1',
          type: 'photo.processing.completed',
          data: {
            photoId,
            results: {
              thumbnails: [],
              metadata: {},
              processingTime: 100
            }
          },
          metadata: {
            source: 'worker',
            traceId: 'e2e-test-trace',
            version: '1.0.0'
          },
          timestamp: new Date().toISOString()
        });

        return { success: true, duration: 100 };
      });

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify workflow completion
      expect(events.length).toBeGreaterThanOrEqual(2);

      const updatedPhoto = await storageCoordinator.getRecord('photos', photoId);
      expect(updatedPhoto.processing_status).toBe('completed');

      await worker.close();
    });
  });

  afterAll(async () => {
    // Cleanup test environment
    await jobQueueCoordinator.destroy();
    await storageCoordinator.destroy();
    await eventBusService.destroy();
  });
});
```

---

## Conclusion

This Shared Infrastructure Layer design provides a **robust, scalable, and maintainable** foundation for the photo management system's broker-centric architecture. The key benefits include:

- **Clean Separation**: Each component has well-defined responsibilities and interfaces
- **Resilience**: Built-in error handling, retry policies, and circuit breakers
- **Scalability**: Horizontal scaling capabilities with auto-scaling policies
- **Observability**: Comprehensive monitoring, metrics, and health checks
- **Security**: Authentication, authorization, rate limiting, and data encryption
- **Maintainability**: Clear configuration management and deployment strategies

The architecture follows industry best practices and provides the flexibility needed to support both current requirements and future growth.
