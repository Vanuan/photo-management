# Event Bus Service - Quick Start Guide

Get started with `@shared-infra/event-bus` in 5 minutes.

## 📦 Installation

```bash
npm install @shared-infra/event-bus
```

## 🚀 Basic Setup

### 1. Configure and Connect

```typescript
import { EventBusClient, EventBusConfig } from '@shared-infra/event-bus';

const config: EventBusConfig = {
  serviceName: 'my-service',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
  logLevel: 'info',
};

const eventBus = new EventBusClient(config);
await eventBus.connect();
```

### 2. Publish Events

```typescript
// Simple event
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'vacation.jpg',
});

// Event with options
await eventBus.publish('photo.uploaded', 
  { photoId: '123', userId: 'user-456' },
  { traceId: 'trace-abc', priority: 1 }
);
```

### 3. Subscribe to Events

```typescript
// Subscribe to specific event
await eventBus.subscribe('photo.uploaded', async (event) => {
  console.log('Photo uploaded:', event.data.photoId);
  await processPhoto(event.data.photoId);
});

// Subscribe to pattern
await eventBus.subscribe('photo.*', async (event) => {
  console.log('Photo event:', event.type);
});
```

### 4. Clean Up

```typescript
process.on('SIGTERM', async () => {
  await eventBus.disconnect();
  process.exit(0);
});
```

## 💡 Common Use Cases

### Photo Processing Pipeline

```typescript
// API Service - Publish upload event
app.post('/photos/upload', async (req, res) => {
  const photo = await savePhoto(req.file);
  
  await eventBus.publish('photo.uploaded', {
    photoId: photo.id,
    userId: req.user.id,
    filename: req.file.originalname,
  });
  
  res.json({ photoId: photo.id });
});

// Worker Service - Process photos
await eventBus.subscribe('photo.uploaded', async (event) => {
  const { photoId, userId } = event.data;
  
  // Send progress updates
  await eventBus.publish('photo.processing.progress', {
    photoId,
    userId,
    progress: 50,
    stage: 'thumbnail-generation',
  });
  
  // Process photo...
  const result = await processPhoto(photoId);
  
  // Send completion
  await eventBus.publish('photo.processing.completed', {
    photoId,
    userId,
    thumbnails: result.thumbnails,
  });
});
```

### Real-time User Notifications

```typescript
// Send notification to specific user
await eventBus.publishToUser('user-123', 'notification.new', {
  title: 'Photo Ready!',
  message: 'Your photo has been processed',
  photoId: '456',
});

// Subscribe to notifications
await eventBus.subscribe('notification.new', async (event) => {
  await sendPushNotification(event.data);
});
```

### Room-based Messaging

```typescript
// Join a room
await eventBus.joinRoom('photo:123');

// Publish to room
await eventBus.publishToRoom('photo:123', 'comment.added', {
  commentId: '789',
  text: 'Great photo!',
  author: 'user-456',
});

// Leave room
await eventBus.leaveRoom('photo:123');
```

### System-wide Broadcasts

```typescript
// Broadcast to all connected clients
await eventBus.broadcast('system.maintenance', {
  scheduled: '2024-01-15T02:00:00Z',
  duration: '30 minutes',
  message: 'Scheduled maintenance',
});
```

## 🔍 Pattern Matching

Use wildcards to subscribe to multiple event types:

```typescript
// All photo events
await eventBus.subscribe('photo.*', handler);

// All processing events for any entity
await eventBus.subscribe('*.processing.*', handler);

// All events
await eventBus.subscribe('*', handler);
```

## 📊 Monitoring

### Health Check

```typescript
const health = await eventBus.healthCheck();
console.log('Status:', health.status); // 'healthy', 'degraded', 'unhealthy'
console.log('Uptime:', health.uptime);
```

### Statistics

```typescript
const stats = await eventBus.getStats();
console.log('Events published:', stats.eventsPublished);
console.log('Events received:', stats.eventsReceived);
console.log('Active subscriptions:', stats.activeSubscriptions);
```

## 🎯 Best Practices

### 1. Use Consistent Event Names

```typescript
// Good ✓
'photo.uploaded'
'photo.processing.started'
'user.profile.updated'

// Bad ✗
'PhotoUploaded'
'processing_started'
'UpdateUser'
```

### 2. Structure Event Data

```typescript
// Good ✓
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'photo.jpg',
  uploadedAt: new Date().toISOString(),
});

// Bad ✗
await eventBus.publish('photo.uploaded', {
  id: '123',
  user: 'user-456',
  name: 'photo.jpg',
  time: Date.now(),
});
```

### 3. Handle Errors

```typescript
await eventBus.subscribe('photo.uploaded', async (event) => {
  try {
    await processPhoto(event.data.photoId);
  } catch (error) {
    console.error('Processing failed:', error);
    // Don't throw - let other handlers continue
  }
});
```

### 4. Clean Up Resources

```typescript
const subscription = await eventBus.subscribe('temp.*', handler);

// When done
await eventBus.unsubscribe(subscription.id);
```

## 🔧 Configuration Options

### Full Configuration

```typescript
const config: EventBusConfig = {
  // Required
  serviceName: 'my-service',
  
  // Redis (required)
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'secret',
    db: 0,
    keyPrefix: 'eventbus:',
  },
  
  // WebSocket client (optional)
  client: {
    url: 'http://localhost:3003',
    authToken: 'your-token',
    reconnection: true,
    reconnectionDelay: 1000,
  },
  
  // Logging
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error'
  
  // Performance
  performance: {
    batchSize: 100,
    batchInterval: 50,
    maxRetries: 3,
    retryDelay: 1000,
  },
};
```

### Subscription Options

```typescript
await eventBus.subscribe('photo.*', handler, {
  retryOnError: true,
  maxRetries: 3,
  timeout: 5000,
  priority: 1,
});
```

## 🐛 Troubleshooting

### Can't Connect to Redis

```bash
# Verify Redis is running
redis-cli ping
# Should return: PONG

# Check Redis connection
redis-cli -h localhost -p 6379 info
```

### Events Not Received

```typescript
// Check pattern matching
await eventBus.subscribe('photo.*', handler);  // Matches 'photo.uploaded'
await eventBus.subscribe('photo.uploaded', handler);  // Exact match only
```

### High Memory Usage

```typescript
// Unsubscribe when done
const subscriptions = [];
subscriptions.push(await eventBus.subscribe('temp.*', handler));

// Clean up
for (const sub of subscriptions) {
  await eventBus.unsubscribe(sub.id);
}
```

## 📚 Next Steps

- **[Full Documentation](./README.md)** - Complete API reference
- **[Examples](./examples/)** - More code examples
- **[Design Document](../../../docs/event-bus/)** - Architecture details
- **[TypeScript Types](./src/types.ts)** - Full type definitions

## 🆘 Need Help?

- Check the [README](./README.md) for detailed API documentation
- See [examples](./examples/) for more use cases
- Review [tests](./tests/) for additional examples
- Open an issue on GitHub

## 📝 Complete Example

```typescript
import { EventBusClient } from '@shared-infra/event-bus';

async function main() {
  // Connect
  const eventBus = new EventBusClient({
    serviceName: 'my-service',
    redis: { host: 'localhost', port: 6379 },
  });
  await eventBus.connect();

  // Subscribe
  await eventBus.subscribe('photo.*', async (event) => {
    console.log('Received:', event.type, event.data);
  });

  // Publish
  await eventBus.publish('photo.uploaded', {
    photoId: '123',
    userId: 'user-456',
  });

  // Monitor
  const stats = await eventBus.getStats();
  console.log('Stats:', stats);

  // Cleanup
  process.on('SIGTERM', async () => {
    await eventBus.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
```

---

**Ready to use Event Bus in your application!** 🚀