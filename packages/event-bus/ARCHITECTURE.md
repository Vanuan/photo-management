# Event Bus Service - Architecture Documentation

## 📋 Table of Contents

- [Overview](#overview)
- [High-Level Architecture](#high-level-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Design Decisions](#design-decisions)
- [Integration Patterns](#integration-patterns)
- [Scalability](#scalability)
- [Error Handling](#error-handling)
- [Security](#security)
- [Performance](#performance)

---

## Overview

The Event Bus Service is a **client library** that provides real-time communication capabilities for the photo management system. It enables event-driven architecture by allowing services to publish and subscribe to events through a reliable Redis pub/sub backbone with optional WebSocket support via Socket.IO.

### Purpose

- **Decouple Services**: Enable loose coupling between microservices
- **Real-time Communication**: Provide instant event distribution
- **Scalable Messaging**: Handle high-volume event traffic
- **Reliable Delivery**: Ensure events are delivered even during failures
- **Pattern-Based Routing**: Support flexible event subscriptions

### Key Characteristics

- **Client Library**: Consumed by backend services (not a standalone server)
- **Redis-Backed**: Uses Redis pub/sub for reliable message distribution
- **TypeScript-First**: Full type safety and IntelliSense support
- **Event-Driven**: Supports publish/subscribe pattern
- **Production-Ready**: Built-in error handling, retries, and monitoring

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                           │
│  (API Services, Worker Services, Notification Services, etc.)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ import & use
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               @shared-infra/event-bus (This Package)            │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  EventBusClient  │  │  EventValidator  │  │   Logger     │ │
│  │  - publish()     │  │  - validate()    │  │  - info()    │ │
│  │  - subscribe()   │  │  - sanitize()    │  │  - error()   │ │
│  │  - connect()     │  └──────────────────┘  └──────────────┘ │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌────────────────────────┐      ┌────────────────────────┐
│   Redis Pub/Sub        │      │   Socket.IO Server     │
│   (Required)           │      │   (Optional)           │
│                        │      │                        │
│  - Event Distribution  │      │  - WebSocket Support   │
│  - Pattern Matching    │      │  - Frontend Clients    │
│  - High Performance    │      │  - Room Management     │
└────────────────────────┘      └────────────────────────┘
```

### Architecture Layers

1. **Application Layer**: Services that use the Event Bus
2. **Event Bus Client Layer**: This package (library code)
3. **Infrastructure Layer**: Redis and optional Socket.IO server
4. **Network Layer**: TCP connections, WebSocket connections

---

## Core Components

### 1. EventBusClient

**Purpose**: Main client class that services use to interact with the Event Bus

**Responsibilities**:
- Manage Redis connections (publisher and subscriber)
- Manage Socket.IO client connection (optional)
- Publish events to channels
- Subscribe to event patterns
- Handle reconnection logic
- Track statistics and health

**Key Methods**:
```typescript
class EventBusClient {
  // Connection management
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean

  // Publishing
  publish(type, data, options): Promise<PublishResult>
  publishToRoom(room, type, data): Promise<PublishResult>
  publishToUser(userId, type, data): Promise<PublishResult>
  broadcast(type, data): Promise<PublishResult>

  // Subscribing
  subscribe(pattern, handler, options): Promise<Subscription>
  unsubscribe(subscriptionId): Promise<boolean>

  // Rooms (requires Socket.IO)
  joinRoom(room): Promise<void>
  leaveRoom(room): Promise<void>
  getRoomMembers(room): Promise<string[]>

  // Monitoring
  healthCheck(): Promise<HealthCheckResult>
  getStats(): Promise<EventBusStats>
}
```

**State Management**:
- `connected`: Boolean flag for connection status
- `subscriptions`: Map of active subscriptions
- `redisPublisher`: Redis client for publishing
- `redisSubscriber`: Redis client for subscribing
- `socket`: Socket.IO client instance (optional)
- `stats`: Event statistics tracker

### 2. Redis Integration

**Purpose**: Provides reliable pub/sub messaging backbone

**Architecture**:
```
┌─────────────────┐         ┌─────────────────┐
│ Redis Publisher │         │ Redis Subscriber│
│  (Write)        │         │  (Read)         │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │  publish(channel, msg)    │  on('message')
         ▼                           ▼
    ┌────────────────────────────────────┐
    │         Redis Server               │
    │  Channels:                         │
    │  - photo.uploaded                  │
    │  - photo.processing.*              │
    │  - user.*                          │
    │  - broadcast                       │
    └────────────────────────────────────┘
```

**Key Features**:
- **Separate Connections**: One for publishing, one for subscribing
- **Pattern Subscriptions**: Using PSUBSCRIBE for wildcards
- **Channel-Based Routing**: Events routed by type
- **Persistent**: Can survive service restarts
- **Scalable**: Redis can handle millions of messages/second

**Channel Naming Convention**:
- `{eventType}` - Default channel (e.g., `photo.uploaded`)
- `room:{roomId}` - Room-specific events
- `user:{userId}` - User-specific events
- `broadcast` - System-wide broadcasts

### 3. Socket.IO Integration (Optional)

**Purpose**: Provides WebSocket connectivity for real-time features

**When Used**:
- Services need to receive real-time updates from frontend
- Admin dashboards need live data
- Services act as WebSocket clients to a central server

**Architecture**:
```
┌─────────────────┐
│ EventBusClient  │
│ (with Socket.IO)│
└────────┬────────┘
         │
         │ WebSocket/Polling
         ▼
┌─────────────────┐
│ Socket.IO Server│ ← Separate service, not in this package
│ (Central Hub)   │
└─────────────────┘
```

**Features**:
- Automatic reconnection
- Transport fallback (WebSocket → HTTP polling)
- Room-based messaging
- Authentication support
- Binary data support

### 4. Event Validator

**Purpose**: Validates events before publishing

**Validations**:
- Required fields presence
- Event type format
- Metadata completeness
- Timestamp validity
- Size limits (max 1MB event, 512KB data)
- Field type checking

**Architecture**:
```typescript
class EventValidator {
  validateEvent(event: Event): void
  validateEventType(type: string): void
  validateMetadata(metadata: EventMetadata): void
  validateTimestamp(timestamp: string): void
  validateEventSize(event: Event): void
  validateDataSize(data: any): void
}
```

### 5. Logger

**Purpose**: Structured logging with configurable levels

**Log Levels**:
- `debug`: Detailed debugging information
- `info`: General informational messages
- `warn`: Warning messages
- `error`: Error messages with stack traces

**Features**:
- Timestamp on every log
- Service name prefix
- JSON formatting for objects
- Configurable minimum level

---

## Data Flow

### Publishing Flow

```
┌─────────────┐
│  Service A  │
└──────┬──────┘
       │
       │ 1. eventBus.publish('photo.uploaded', data)
       ▼
┌─────────────────┐
│ EventBusClient  │
│  - Validate     │ ← 2. Validate event
│  - Enrich       │ ← 3. Add metadata
│  - Serialize    │ ← 4. JSON.stringify
└──────┬──────────┘
       │
       │ 5. Redis PUBLISH channel message
       ▼
┌─────────────────┐
│  Redis Server   │
└──────┬──────────┘
       │
       │ 6. Broadcast to all subscribers
       ▼
    ┌──┴──────────────┬──────────────┐
    ▼                 ▼              ▼
┌─────────┐     ┌─────────┐    ┌─────────┐
│Service B│     │Service C│    │Service D│
└─────────┘     └─────────┘    └─────────┘
```

### Subscribing Flow

```
┌─────────────┐
│  Service B  │
└──────┬──────┘
       │
       │ 1. eventBus.subscribe('photo.*', handler)
       ▼
┌─────────────────┐
│ EventBusClient  │
│  - Store sub    │ ← 2. Store subscription
│  - Redis sub    │ ← 3. PSUBSCRIBE 'photo.*'
└──────┬──────────┘
       │
       │ 4. Wait for messages...
       ▼
┌─────────────────┐
│  Redis Server   │ ← Event arrives
└──────┬──────────┘
       │
       │ 5. on('pmessage', handler)
       ▼
┌─────────────────┐
│ EventBusClient  │
│  - Parse JSON   │ ← 6. JSON.parse
│  - Match pattern│ ← 7. Check subscriptions
│  - Execute      │ ← 8. Call handler(event)
└─────────────────┘
```

### Pattern Matching Flow

```
Subscriptions:
- Service A: 'photo.*'
- Service B: 'photo.processing.*'
- Service C: 'photo.uploaded'

Event Published: 'photo.uploaded'

Pattern Matching:
1. 'photo.*' matches 'photo.uploaded' ✓ → Service A receives
2. 'photo.processing.*' vs 'photo.uploaded' ✗ → Service B skips
3. 'photo.uploaded' === 'photo.uploaded' ✓ → Service C receives

Result: Services A and C receive the event
```

---

## Design Decisions

### 1. Client Library vs Standalone Service

**Decision**: Build as a client library, not a standalone service

**Rationale**:
- Services import and use directly (no extra network hop)
- Simpler deployment (no additional service to manage)
- Each service gets its own connection (better isolation)
- Redis handles distribution (proven, reliable)
- Can still have separate WebSocket server if needed

**Trade-offs**:
- ✅ Simpler architecture
- ✅ Lower latency (direct Redis connection)
- ✅ Better fault isolation
- ❌ Each service needs Redis connection
- ❌ No centralized WebSocket server included

### 2. Redis as Primary Mechanism

**Decision**: Use Redis pub/sub as the primary event distribution mechanism

**Rationale**:
- Proven reliability at scale
- High performance (millions of messages/second)
- Pattern matching built-in (PSUBSCRIBE)
- Persistent connections
- Available in all deployment environments
- Simple operational model

**Alternatives Considered**:
- RabbitMQ: More features but more complex
- Kafka: Better for event sourcing but overkill for real-time events
- Direct Socket.IO: No server-to-server communication

### 3. Socket.IO as Optional

**Decision**: Make Socket.IO client optional, not required

**Rationale**:
- Not all services need WebSocket connectivity
- Most backend services only need Redis pub/sub
- Reduces dependencies for simple use cases
- Allows services to choose their own WebSocket strategy

**Use Cases for Socket.IO**:
- Admin dashboards that need real-time data
- Services that act as WebSocket servers themselves
- Integration with frontend clients

### 4. Pattern-Based Subscriptions

**Decision**: Support wildcard patterns for subscriptions

**Rationale**:
- Flexible event routing
- Subscribe to entire event families (`photo.*`)
- Subscribe to specific stages (`*.processing.completed`)
- Reduces subscription management overhead
- Common pattern in event systems

**Implementation**:
- Use Redis PSUBSCRIBE for patterns
- Use Redis SUBSCRIBE for exact matches
- Convert patterns to regex for Socket.IO

### 5. Type-First Design

**Decision**: Build with TypeScript and comprehensive type definitions

**Rationale**:
- Catch errors at compile time
- Better IDE support and IntelliSense
- Self-documenting code
- Easier refactoring
- Industry best practice for libraries

**Benefits**:
- Generic `Event<T>` type for custom events
- Predefined photo management event types
- Full type safety for configuration
- Type inference for handlers

### 6. Validation Layer

**Decision**: Validate events before publishing

**Rationale**:
- Prevent invalid events from entering the system
- Catch errors early (fail fast)
- Enforce size limits (prevent memory issues)
- Standardize event structure
- Improve debuggability

**Validations**:
- Required fields
- Type formats
- Size limits
- Timestamp validity

### 7. Automatic Reconnection

**Decision**: Implement automatic reconnection with exponential backoff

**Rationale**:
- Handle transient network failures
- Survive Redis restarts
- No manual intervention required
- Standard pattern for production systems

**Strategy**:
- Exponential backoff for retries
- Maximum retry delay cap
- Resubscribe on reconnect
- Log reconnection attempts

---

## Integration Patterns

### Pattern 1: Simple Pub/Sub

```typescript
// Service A - Publisher
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
});

// Service B - Subscriber
await eventBus.subscribe('photo.uploaded', async (event) => {
  await processPhoto(event.data.photoId);
});
```

**Use Cases**:
- Simple notifications
- Trigger background jobs
- Update caches

### Pattern 2: Pipeline Processing

```typescript
// API Service
await eventBus.publish('photo.uploaded', data);

// Worker Service
await eventBus.subscribe('photo.uploaded', async (event) => {
  await eventBus.publish('photo.processing.started', {
    photoId: event.data.photoId,
    jobId: uuidv4(),
  });
  
  await processPhoto(event.data.photoId);
  
  await eventBus.publish('photo.processing.completed', {
    photoId: event.data.photoId,
    result: processedData,
  });
});

// Notification Service
await eventBus.subscribe('photo.processing.completed', async (event) => {
  await notifyUser(event.data);
});
```

**Use Cases**:
- Multi-stage processing
- Workflow orchestration
- Progress tracking

### Pattern 3: Fan-Out

```typescript
// Single publisher
await eventBus.publish('user.registered', userData);

// Multiple subscribers
await eventBus.subscribe('user.registered', sendWelcomeEmail);
await eventBus.subscribe('user.registered', createUserProfile);
await eventBus.subscribe('user.registered', trackAnalytics);
await eventBus.subscribe('user.registered', sendToDataWarehouse);
```

**Use Cases**:
- Broadcasting notifications
- Multiple side effects
- Analytics and logging

### Pattern 4: Request/Response (Anti-Pattern)

```typescript
// ❌ DON'T: Event Bus is not for synchronous request/response
await eventBus.publish('get.user.data', { userId: '123' });
const response = await waitForResponse(); // This doesn't work

// ✅ DO: Use HTTP API or direct function calls
const userData = await userService.getUser('123');
```

**Note**: Event Bus is for asynchronous, fire-and-forget events, not synchronous RPC.

---

## Scalability

### Horizontal Scaling

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Service A  │  │  Service A  │  │  Service A  │
│  Instance 1 │  │  Instance 2 │  │  Instance 3 │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ Redis Cluster │
                └───────────────┘
```

**Key Points**:
- Each service instance has its own EventBusClient
- All instances publish to same Redis
- All instances receive subscribed events
- Services handle deduplication if needed
- Redis handles load distribution

### Performance Characteristics

**Throughput**:
- Redis: 100,000+ messages/second per instance
- EventBusClient: Limited by network and parsing (10,000+ msgs/sec)
- Bottleneck typically in event handlers, not Event Bus

**Latency**:
- Publishing: ~1-5ms (Redis write)
- Delivery: ~1-10ms (Redis → subscriber)
- Total: ~2-15ms end-to-end
- Handler execution time is separate

**Memory**:
- Base: ~50MB per EventBusClient instance
- Per subscription: ~1KB
- Per event in flight: event size + ~100 bytes overhead

**Connections**:
- 2 Redis connections per EventBusClient (pub + sub)
- 1 Socket.IO connection per client (if used)

### Scaling Redis

```
┌──────────────────────────────────────┐
│         Redis Cluster                │
│  ┌────────┐  ┌────────┐  ┌────────┐ │
│  │Master 1│  │Master 2│  │Master 3│ │
│  └────────┘  └────────┘  └────────┘ │
│  ┌────────┐  ┌────────┐  ┌────────┐ │
│  │Slave 1 │  │Slave 2 │  │Slave 3 │ │
│  └────────┘  └────────┘  └────────┘ │
└──────────────────────────────────────┘
```

**Benefits**:
- High availability
- Automatic failover
- Horizontal scaling
- Data persistence

---

## Error Handling

### Error Categories

1. **Connection Errors**: Redis/Socket.IO connection issues
2. **Validation Errors**: Invalid events
3. **Handler Errors**: Exceptions in subscriber handlers
4. **Timeout Errors**: Handler execution timeouts
5. **Resource Errors**: Memory, connection limits

### Error Handling Strategy

```typescript
// 1. Connection Errors - Auto-retry
try {
  await eventBus.connect();
} catch (error) {
  // Exponential backoff, max retries
  await retryConnection();
}

// 2. Validation Errors - Fail fast
try {
  await eventBus.publish('invalid', invalidData);
} catch (ValidationError) {
  logger.error('Invalid event', error);
  // Don't retry, fix the event
}

// 3. Handler Errors - Isolate
await eventBus.subscribe('photo.*', async (event) => {
  try {
    await processPhoto(event.data.photoId);
  } catch (error) {
    logger.error('Handler error', error);
    // Don't throw, let other handlers continue
  }
});

// 4. Timeout Errors - Configurable
await eventBus.subscribe('photo.*', handler, {
  timeout: 5000, // 5 second timeout
  retryOnError: true,
  maxRetries: 3,
});
```

### Retry Logic

```typescript
const retryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

// Retry attempt 1: 1000ms delay
// Retry attempt 2: 2000ms delay
// Retry attempt 3: 4000ms delay
// Failed after 3 attempts
```

---

## Security

### Current Implementation

1. **Event Validation**: Size limits, type checking
2. **Service Identification**: Each event has source metadata
3. **Trace IDs**: Audit trail for events
4. **Optional Authentication**: Token support for Socket.IO

### Production Recommendations

1. **Redis Security**:
   - Use password authentication
   - Enable TLS/SSL
   - Network isolation (VPC)
   - Firewall rules

2. **Application Security**:
   - Validate event data in handlers
   - Sanitize user input before publishing
   - Rate limiting at application level
   - Monitor for abuse patterns

3. **Access Control**:
   - Services subscribe only to needed events
   - Use separate Redis instances for sensitive data
   - Implement service authentication

4. **Monitoring**:
   - Log all events with trace IDs
   - Alert on unusual patterns
   - Track error rates
   - Monitor connection counts

---

## Performance

### Optimization Techniques

1. **Connection Pooling**: Reuse Redis connections
2. **Batch Processing**: Group multiple events
3. **Lazy Validation**: Only validate when necessary
4. **Efficient Serialization**: Use JSON efficiently
5. **Pattern Optimization**: Minimize wildcard subscriptions

### Monitoring Metrics

```typescript
const stats = await eventBus.getStats();

// Key metrics:
- eventsPublished: Total events published
- eventsReceived: Total events received
- eventsDelivered: Successfully delivered to handlers
- eventsFailed: Failed deliveries
- activeSubscriptions: Current subscriptions
- errorRate: Failed / Published ratio
- messagesPerSecond: Throughput
- averageLatency: End-to-end time
```

### Performance Tuning

```typescript
const config: EventBusConfig = {
  serviceName: 'my-service',
  redis: {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  },
  performance: {
    batchSize: 100,
    batchInterval: 50,
    maxRetries: 3,
    retryDelay: 1000,
  },
};
```

---

## Summary

The Event Bus Service provides a robust, scalable, and type-safe solution for real-time event distribution in the photo management system. Its architecture balances simplicity with production-readiness, making it easy to use while handling edge cases and failures gracefully.

**Key Takeaways**:
- Client library pattern for simplicity
- Redis pub/sub for reliability
- TypeScript for safety
- Pattern matching for flexibility
- Comprehensive error handling
- Production-ready monitoring

**Next Steps**:
- Review [QUICK_START.md](./QUICK_START.md) for usage
- See [examples/](./examples/) for code samples
- Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for details