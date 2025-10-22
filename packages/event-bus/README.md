# @shared-infra/event-bus

Real-time communication and event distribution library for the photo management system. Built on Socket.IO and Redis for reliable, scalable messaging between backend services and frontend clients.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Event Types](#event-types)
- [Usage Examples](#usage-examples)
- [Best Practices](#best-practices)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

The Event Bus Service is a **shared library** that provides a unified interface for real-time communication across your application. It enables:

- **Real-time Updates**: Instant notifications to web clients via WebSocket
- **Service Communication**: Event-driven architecture between backend services
- **Pub/Sub Messaging**: Scalable message distribution using Redis
- **Room Management**: Targeted messaging to specific users or groups
- **Reliable Delivery**: Built-in retries and error handling

## Features

✅ **Simple API** - Easy-to-use interface for publishing and subscribing to events  
✅ **Real-time Communication** - WebSocket support via Socket.IO  
✅ **Scalable Pub/Sub** - Redis-backed message distribution  
✅ **Pattern Matching** - Subscribe to events using wildcards (`photo.*`)  
✅ **Event Filtering** - Filter events based on custom conditions  
✅ **Automatic Reconnection** - Resilient connection management  
✅ **TypeScript Support** - Full type definitions included  
✅ **Health Monitoring** - Built-in health checks and statistics  

## Installation

```bash
npm install @shared-infra/event-bus
```

### Prerequisites

- Node.js >= 18.0.0
- Redis >= 6.0 (for pub/sub messaging)
- Socket.IO Server (optional, for WebSocket support)

## Quick Start

### Basic Usage

```typescript
import { EventBusClient, EventBusConfig } from '@shared-infra/event-bus';

// Configure the Event Bus client
const config: EventBusConfig = {
  serviceName: 'photo-api-service',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  logLevel: 'info',
};

// Create and connect
const eventBus = new EventBusClient(config);
await eventBus.connect();

// Publish an event
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'vacation.jpg',
  size: 1024000,
  mimeType: 'image/jpeg',
  uploadedAt: new Date().toISOString(),
});

// Subscribe to events
await eventBus.subscribe('photo.*', async (event) => {
  console.log('Photo event received:', event.type, event.data);
});

// Clean up
process.on('SIGTERM', async () => {
  await eventBus.disconnect();
});
```

## Configuration

### EventBusConfig

```typescript
interface EventBusConfig {
  // Required: Service identification
  serviceName: string;
  
  // Required: Redis configuration
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
  };
  
  // Optional: Client configuration (for WebSocket)
  client?: {
    url: string;
    authToken?: string;
    reconnection?: boolean;
    reconnectionDelay?: number;
    reconnectionAttempts?: number;
    timeout?: number;
  };
  
  // Optional: Logging level
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  
  // Optional: Performance settings
  performance?: {
    batchSize?: number;
    batchInterval?: number;
    maxRetries?: number;
    retryDelay?: number;
  };
}
```

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0

# Event Bus Server (optional, for WebSocket)
EVENT_BUS_URL=http://localhost:3003
EVENT_BUS_TOKEN=your-auth-token

# Service Configuration
SERVICE_NAME=photo-api-service
LOG_LEVEL=info
```

## API Reference

### EventBusClient

#### `connect(): Promise<void>`

Connect to the Event Bus service (Redis and optionally Socket.IO).

```typescript
await eventBus.connect();
```

#### `disconnect(): Promise<void>`

Disconnect from the Event Bus service.

```typescript
await eventBus.disconnect();
```

#### `isConnected(): boolean`

Check if the client is connected.

```typescript
if (eventBus.isConnected()) {
  console.log('Connected to Event Bus');
}
```

### Publishing Events

#### `publish(eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>`

Publish an event to the default channel.

```typescript
const result = await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'photo.jpg',
});

console.log('Event published:', result.eventId);
```

#### `publishToRoom(room: string, eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>`

Publish an event to a specific room.

```typescript
await eventBus.publishToRoom('photo:123', 'processing.update', {
  progress: 50,
  stage: 'thumbnail-generation',
});
```

#### `publishToUser(userId: string, eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>`

Publish an event to a specific user.

```typescript
await eventBus.publishToUser('user-456', 'notification.new', {
  title: 'Photo Ready',
  message: 'Your photo has been processed',
  photoId: '123',
});
```

#### `broadcast(eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>`

Broadcast an event to all connected clients.

```typescript
await eventBus.broadcast('system.maintenance', {
  scheduled: '2024-01-15T02:00:00Z',
  duration: '30 minutes',
});
```

### Subscribing to Events

#### `subscribe(pattern: string, handler: EventHandler, options?: SubscriptionOptions): Promise<Subscription>`

Subscribe to events matching a pattern.

```typescript
// Subscribe to all photo events
const subscription = await eventBus.subscribe('photo.*', async (event) => {
  console.log('Photo event:', event.type, event.data);
});

// Subscribe to specific event
await eventBus.subscribe('photo.uploaded', async (event) => {
  const { photoId, userId } = event.data;
  await processPhoto(photoId, userId);
});

// Subscribe with options
await eventBus.subscribe('photo.processing.*', async (event) => {
  await updateDatabase(event.data);
}, {
  retryOnError: true,
  maxRetries: 3,
  timeout: 5000,
});
```

#### `unsubscribe(subscriptionId: string): Promise<boolean>`

Unsubscribe from events.

```typescript
const subscription = await eventBus.subscribe('photo.*', handler);

// Later...
await eventBus.unsubscribe(subscription.id);
```

### Room Management

#### `joinRoom(room: string): Promise<void>`

Join a room for targeted messaging.

```typescript
await eventBus.joinRoom('photo:123');
```

#### `leaveRoom(room: string): Promise<void>`

Leave a room.

```typescript
await eventBus.leaveRoom('photo:123');
```

#### `getRoomMembers(room: string): Promise<string[]>`

Get members of a room.

```typescript
const members = await eventBus.getRoomMembers('photo:123');
console.log('Room members:', members);
```

### Monitoring

#### `healthCheck(): Promise<HealthCheckResult>`

Check the health of the Event Bus connection.

```typescript
const health = await eventBus.healthCheck();
console.log('Health status:', health.status);
console.log('Uptime:', health.uptime);
```

#### `getStats(): Promise<EventBusStats>`

Get Event Bus statistics.

```typescript
const stats = await eventBus.getStats();
console.log('Events published:', stats.eventsPublished);
console.log('Events received:', stats.eventsReceived);
console.log('Active subscriptions:', stats.activeSubscriptions);
```

## Event Types

### Photo Management Events

```typescript
// Photo uploaded
eventBus.publish('photo.uploaded', {
  photoId: string;
  userId: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
});

// Photo processing started
eventBus.publish('photo.processing.started', {
  photoId: string;
  userId: string;
  jobId: string;
  startedAt: string;
  estimatedDuration?: number;
});

// Photo processing progress
eventBus.publish('photo.processing.progress', {
  photoId: string;
  userId: string;
  jobId: string;
  progress: number; // 0-100
  stage: string;
  currentStep?: string;
  estimatedCompletion?: string;
});

// Photo processing completed
eventBus.publish('photo.processing.completed', {
  photoId: string;
  userId: string;
  jobId: string;
  completedAt: string;
  duration: number;
  thumbnails: ThumbnailInfo[];
  metadata: PhotoMetadata;
  storageInfo: StorageInfo;
});

// Photo processing failed
eventBus.publish('photo.processing.failed', {
  photoId: string;
  userId: string;
  jobId: string;
  failedAt: string;
  error: ErrorInfo;
  retryable: boolean;
  retryCount?: number;
});
```

## Usage Examples

### Example 1: Photo Upload Flow

```typescript
// API Service - Handle photo upload
app.post('/photos/upload', async (req, res) => {
  const file = req.file;
  const userId = req.user.id;
  
  // Save photo metadata
  const photo = await savePhotoMetadata(file, userId);
  
  // Publish upload event
  await eventBus.publish('photo.uploaded', {
    photoId: photo.id,
    userId: userId,
    filename: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
    uploadedAt: new Date().toISOString(),
  });
  
  res.json({
    success: true,
    photoId: photo.id,
    message: 'Upload received - processing started',
  });
});
```

### Example 2: Worker Processing Pipeline

```typescript
// Worker Service - Process uploaded photos
await eventBus.subscribe('photo.uploaded', async (event) => {
  const { photoId, userId } = event.data;
  
  try {
    // Send processing started event
    await eventBus.publish('photo.processing.started', {
      photoId,
      userId,
      jobId: uuidv4(),
      startedAt: new Date().toISOString(),
    });
    
    // Process photo with progress updates
    for (const stage of ['validation', 'resize', 'thumbnail', 'optimize']) {
      await processStage(photoId, stage);
      
      await eventBus.publish('photo.processing.progress', {
        photoId,
        userId,
        jobId: jobId,
        progress: calculateProgress(stage),
        stage: stage,
      });
    }
    
    // Send completion event
    await eventBus.publish('photo.processing.completed', {
      photoId,
      userId,
      jobId: jobId,
      completedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
      thumbnails: generatedThumbnails,
      metadata: photoMetadata,
      storageInfo: storageDetails,
    });
  } catch (error) {
    // Send failure event
    await eventBus.publish('photo.processing.failed', {
      photoId,
      userId,
      jobId: jobId,
      failedAt: new Date().toISOString(),
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      retryable: isRetryable(error),
    });
  }
});
```

### Example 3: Real-time Notifications

```typescript
// Notification Service - Send user notifications
await eventBus.subscribe('photo.processing.completed', async (event) => {
  const { photoId, userId } = event.data;
  
  // Send notification to user
  await eventBus.publishToUser(userId, 'notification.new', {
    type: 'photo_processed',
    title: 'Your photo is ready!',
    message: 'Photo processing completed successfully',
    photoId: photoId,
    link: `/photos/${photoId}`,
    timestamp: new Date().toISOString(),
  });
});

await eventBus.subscribe('photo.processing.failed', async (event) => {
  const { photoId, userId, error } = event.data;
  
  // Send error notification to user
  await eventBus.publishToUser(userId, 'notification.new', {
    type: 'photo_processing_failed',
    title: 'Photo processing failed',
    message: `Failed to process your photo: ${error.message}`,
    photoId: photoId,
    severity: 'error',
    timestamp: new Date().toISOString(),
  });
});
```

### Example 4: Pattern-based Subscriptions

```typescript
// Subscribe to all user events
await eventBus.subscribe('user.*', async (event) => {
  console.log('User event:', event.type);
  await auditLog.record(event);
});

// Subscribe to all processing events
await eventBus.subscribe('*.processing.*', async (event) => {
  console.log('Processing event:', event.type);
  await updateDashboard(event);
});

// Subscribe to specific photo events
await eventBus.subscribe('photo.processing.completed', async (event) => {
  await generateAnalytics(event.data);
});
```

### Example 5: Event Filtering

```typescript
// Subscribe with filter
await eventBus.subscribe('photo.*', async (event) => {
  console.log('High-priority photo event:', event.type);
}, {
  metadata: {
    filter: {
      conditions: [
        { field: 'data.priority', operator: 'equals', value: 'high' },
        { field: 'data.size', operator: 'greaterThan', value: 1000000 },
      ],
      operator: 'AND',
    },
  },
});
```

## Best Practices

### 1. Connection Management

Always properly connect and disconnect:

```typescript
const eventBus = new EventBusClient(config);

// Connect on startup
await eventBus.connect();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await eventBus.disconnect();
  process.exit(0);
});
```

### 2. Error Handling

Handle errors in event handlers:

```typescript
await eventBus.subscribe('photo.uploaded', async (event) => {
  try {
    await processPhoto(event.data.photoId);
  } catch (error) {
    logger.error('Failed to process photo', error);
    // Don't throw - let other handlers continue
  }
});
```

### 3. Event Naming

Use consistent naming conventions:

```typescript
// Good: namespace.action.status
'photo.processing.completed'
'user.profile.updated'
'system.health.degraded'

// Bad: inconsistent naming
'PhotoProcessed'
'user_update'
'SystemErr'
```

### 4. Event Data Structure

Keep event data clean and consistent:

```typescript
// Good: structured data
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'photo.jpg',
  uploadedAt: new Date().toISOString(),
});

// Bad: unstructured data
await eventBus.publish('photo.uploaded', {
  id: '123',
  user: 'user-456',
  name: 'photo.jpg',
  time: Date.now(),
});
```

### 5. Resource Cleanup

Unsubscribe when done:

```typescript
const subscription = await eventBus.subscribe('temp.*', handler);

// When no longer needed
await eventBus.unsubscribe(subscription.id);
```

### 6. Monitoring

Regularly check health:

```typescript
setInterval(async () => {
  const health = await eventBus.healthCheck();
  if (health.status !== 'healthy') {
    logger.warn('Event Bus unhealthy', health);
  }
}, 60000); // Check every minute
```

## Testing

### Unit Testing

```typescript
import { EventBusClient } from '@shared-infra/event-bus';

describe('EventBusClient', () => {
  let eventBus: EventBusClient;
  
  beforeAll(async () => {
    eventBus = new EventBusClient({
      serviceName: 'test-service',
      redis: {
        host: 'localhost',
        port: 6379,
      },
    });
    await eventBus.connect();
  });
  
  afterAll(async () => {
    await eventBus.disconnect();
  });
  
  it('should publish and receive events', async () => {
    const received: any[] = [];
    
    await eventBus.subscribe('test.*', (event) => {
      received.push(event);
    });
    
    await eventBus.publish('test.event', { message: 'hello' });
    
    // Wait for event to be received
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('test.event');
    expect(received[0].data.message).toBe('hello');
  });
});
```

### Integration Testing

```typescript
describe('Photo Processing Flow', () => {
  it('should handle complete photo processing flow', async () => {
    const events: string[] = [];
    
    // Subscribe to all photo events
    await eventBus.subscribe('photo.*', (event) => {
      events.push(event.type);
    });
    
    // Simulate upload
    await eventBus.publish('photo.uploaded', {
      photoId: '123',
      userId: 'user-456',
      filename: 'test.jpg',
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    expect(events).toContain('photo.uploaded');
    expect(events).toContain('photo.processing.started');
    expect(events).toContain('photo.processing.completed');
  });
});
```

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to Redis

```
Error: Connection to Redis failed
```

**Solution**: Verify Redis is running and accessible

```bash
# Test Redis connection
redis-cli -h localhost -p 6379 ping

# Check Redis logs
docker logs redis-container
```

### Event Not Received

**Problem**: Published events not received by subscribers

**Solution**: Check pattern matching

```typescript
// Ensure pattern matches event type
await eventBus.subscribe('photo.*', handler);  // Matches 'photo.uploaded'
await eventBus.subscribe('photo.processing.*', handler);  // Matches 'photo.processing.started'
```

### Memory Leaks

**Problem**: Memory usage increasing over time

**Solution**: Unsubscribe from unused subscriptions

```typescript
// Keep track of subscriptions
const subscriptions = new Map();

// Clean up when done
for (const [id, sub] of subscriptions.entries()) {
  await eventBus.unsubscribe(id);
}
```

### Performance Issues

**Problem**: High latency or slow event delivery

**Solution**: Check Redis performance and connection pool

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
  },
};
```

## Support

For issues, questions, or contributions:

- GitHub Issues: [Report a bug](https://github.com/your-org/receipt-processor/issues)
- Documentation: [Full documentation](../../../docs/event-bus/)
- Examples: [See examples directory](./examples/)

## License

MIT