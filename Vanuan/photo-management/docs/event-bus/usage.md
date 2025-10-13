# Event Bus Service - Usage Guide

## 🎯 **Event Bus Service is a `@shared-infra` library** that backend services use for real-time communication.

## 🏗️ **How It Actually Works**

### **Backend Service Usage:**
```typescript
// In your photo-upload API service
import { eventBus } from '@shared-infra/event-bus';

// When user uploads a photo
app.post('/photos/upload', async (req, res) => {
  const file = req.file;
  const userId = req.user.id;

  // Process the upload
  const photo = await processUpload(file, userId);

  // Publish event to notify the system
  await eventBus.publish('photo.uploaded', {
    photoId: photo.id,
    userId: userId,
    filename: file.originalname,
    size: file.size,
    uploadedAt: new Date().toISOString()
  });

  res.json({
    success: true,
    photoId: photo.id,
    message: 'Upload received - processing started'
  });
});
```

### **In Your Worker Service:**
```typescript
// In your photo-processing worker
import { eventBus } from '@shared-infra/event-bus';
import { jobCoordinator } from '@shared-infra/job-queue';

// Subscribe to photo upload events
await eventBus.subscribe('photo.uploaded', async (event) => {
  const { photoId, userId } = event.data;

  // Send processing started event
  await eventBus.publish('photo.processing.started', {
    photoId,
    userId,
    startedAt: new Date().toISOString()
  });

  // Process the photo
  await processPhoto(photoId);

  // Send completion event
  await eventBus.publish('photo.processing.completed', {
    photoId,
    userId,
    thumbnails: ['small', 'medium', 'large'],
    completedAt: new Date().toISOString()
  });
});

// Subscribe to specific user events
await eventBus.subscribe('user.*', async (event) => {
  // Handle all user-related events
  console.log(`User event: ${event.type}`, event.data);
});
```

### **In Your Notification Service:**
```typescript
// In your notification service
import { eventBus } from '@shared-infra/event-bus';

// Subscribe to important events
await eventBus.subscribe('photo.processing.completed', async (event) => {
  const { photoId, userId } = event.data;

  // Send notification to user
  await sendNotification(userId, {
    type: 'photo_processed',
    title: 'Your photo is ready!',
    message: 'Photo processing completed successfully',
    photoId: photoId
  });
});

await eventBus.subscribe('photo.processing.failed', async (event) => {
  const { photoId, userId, error } = event.data;

  // Send error notification
  await sendNotification(userId, {
    type: 'photo_processing_failed',
    title: 'Photo processing failed',
    message: `Failed to process your photo: ${error.message}`,
    photoId: photoId
  });
});
```

## 🏗️ **Deployment Reality**

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   API Service   │         │  Worker Service │         │  Notification   │
│   (Node.js)     │         │   (Node.js)     │         │   Service       │
└─────────────────┘         └─────────────────┘         └─────────────────┘
         │                            │                            │
         └─────► Event Bus Client ◄─────┼──────────────────────────┘
                 (Library)              │
                        │               │
                        ▼               ▼
              ┌──────────────────┐   ┌─────────────┐
              │ Event Bus Service│   │    Redis    │
              │   (Node.js)      │   │   Cluster   │
              └──────────────────┘   └─────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │   Web Clients   │
              │   (Browsers)    │
              └─────────────────┘
```

## 📦 **What the Event Bus Provides**

### **As a Library:**
```typescript
// Simplified interface your services use
export const eventBus = {
  // Publishing events
  publish(eventType: string, data: any, options?: PublishOptions): Promise<void>,
  publishToRoom(room: string, eventType: string, data: any): Promise<void>,
  publishToUser(userId: string, eventType: string, data: any): Promise<void>,

  // Subscribing to events
  subscribe(eventPattern: string, handler: EventHandler): Promise<Subscription>,
  subscribeToRoom(room: string, handler: EventHandler): Promise<Subscription>,
  unsubscribe(subscriptionId: string): Promise<void>,

  // Room management
  joinRoom(room: string): Promise<void>,
  leaveRoom(room: string): Promise<void>,

  // WebSocket operations (for real-time features)
  broadcast(eventType: string, data: any): Promise<void>,
  sendToUser(userId: string, eventType: string, data: any): Promise<void>,

  // Monitoring
  getStats(): Promise<EventBusStats>,
  healthCheck(): Promise<HealthStatus>
};

// Event handler type
type EventHandler = (event: {
  type: string;
  data: any;
  metadata: {
    source: string;
    timestamp: string;
    traceId?: string;
  };
}) => Promise<void> | void;
```

### **Key Benefits:**
1. **Real-time Communication**: Instant updates between services and clients
2. **Event-driven Architecture**: Loose coupling between system components
3. **Scalable Pub/Sub**: Handle millions of events efficiently
4. **WebSocket Support**: Real-time updates to web clients
5. **Reliable Delivery**: Built-in retries and error handling
6. **Flexible Routing**: Pattern-based subscriptions and room system

## 🔄 **Real-World Flow**

### **API Service (Web Server):**
```bash
# Runs your web API
npm run start:api
# Uses eventBus.publish() to notify about uploads
```

### **Worker Service (Background Jobs):**
```bash
# Runs your photo processors
npm run start:workers
# Uses eventBus.subscribe() to listen for new uploads
# Uses eventBus.publish() to send progress updates
```

### **Frontend Client:**
```javascript
// Connects via WebSocket for real-time updates
const socket = io('https://events.your-app.com');

socket.on('photo.processing.progress', (event) => {
  updateProgressBar(event.photoId, event.progress);
});

socket.on('photo.processing.completed', (event) => {
  showThumbnails(event.photoId, event.thumbnails);
});
```

## 🎯 **Common Usage Patterns**

### **1. Photo Processing Pipeline**
```typescript
// API Service - Trigger processing
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456',
  filename: 'vacation.jpg'
});

// Worker Service - Handle processing
await eventBus.subscribe('photo.uploaded', async (event) => {
  const { photoId, userId } = event.data;

  // Update progress
  await eventBus.publish('photo.processing.progress', {
    photoId,
    progress: 25,
    stage: 'validation'
  });

  // Process image
  await processImage(photoId);

  // Send completion
  await eventBus.publish('photo.processing.completed', {
    photoId,
    thumbnails: await generateThumbnails(photoId)
  });
});
```

### **2. Real-time User Notifications**
```typescript
// Send to specific user
await eventBus.publishToUser('user-123', 'notification.new', {
  title: 'Photo processed',
  message: 'Your vacation photo is ready!',
  photoId: '456'
});

// Send to user's current session room
await eventBus.publishToRoom('session:abc123', 'notification.new', {
  title: 'Welcome back!',
  message: 'We missed you!'
});
```

### **3. System-wide Broadcasts**
```typescript
// Send to all connected clients
await eventBus.broadcast('system.maintenance', {
  scheduled: '2024-01-15T02:00:00Z',
  duration: '30 minutes',
  message: 'Routine maintenance scheduled'
});

// Send to all services
await eventBus.publish('system.config.updated', {
  configKey: 'upload.limits',
  newValue: '50MB',
  updatedBy: 'admin-789'
});
```

## 🛠️ **Configuration Examples**

### **Basic Setup:**
```typescript
import { eventBus } from '@shared-infra/event-bus';

// That's it! The library handles connection automatically
const result = await eventBus.publish('user.registered', {
  userId: '123',
  email: 'user@example.com'
});
```

### **Advanced Configuration:**
```typescript
import { EventBusClient } from '@shared-infra/event-bus';

const eventBus = new EventBusClient({
  // Connection settings
  eventBusUrl: process.env.EVENT_BUS_URL || 'http://localhost:3003',

  // Authentication
  serviceName: 'photo-api-service',
  authToken: process.env.EVENT_BUS_TOKEN,

  // Performance
  maxRetries: 3,
  timeout: 5000,
  batchSize: 10,

  // Monitoring
  enableMetrics: true,
  logLevel: 'info'
});
```

## 📊 **Monitoring & Debugging**

### **Check Service Health:**
```typescript
const health = await eventBus.healthCheck();
console.log('Event Bus Health:', health.status); // 'healthy', 'degraded', 'unhealthy'

const stats = await eventBus.getStats();
console.log('Events published:', stats.eventsPublished);
console.log('Active subscriptions:', stats.activeSubscriptions);
```

### **Debug Event Flow:**
```typescript
// Add trace ID to track events through the system
await eventBus.publish('photo.uploaded', {
  photoId: '123',
  userId: 'user-456'
}, {
  traceId: 'trace-abc-123',
  source: 'photo-api-service'
});
```

## 🎯 **In Simple Terms**

> "The Event Bus Service is a **shared npm package** that all your backend services import to communicate with each other and send real-time updates to web clients."

It's **NOT** just a messaging library - it's a **complete real-time communication system** that connects your entire application ecosystem.

**Analogy**:
- **Job Queue Coordinator** = "axios for background jobs"
- **Storage Coordinator** = "axios for storage operations"
- **Event Bus Service** = "axios for real-time communication"

All three are **libraries** your services use, providing standardized interfaces to their respective backend systems!

## 📁 **Project Structure**
```
shared-infra/
├── job-queue-coordinator/     # BullMQ/Redis wrapper
│   └── src/
├── storage-coordinator/       # MinIO/SQLite wrapper
├── event-bus/                 # Socket.IO/Redis wrapper
│   └── src/
└── package.json              # @shared-infra package

photo-api-service/
├── src/
├── package.json
└── # Uses all @shared-infra libraries

photo-worker-service/
├── src/
├── package.json
└── # Uses all @shared-infra libraries

notification-service/
├── src/
├── package.json
└── # Uses event-bus library
```

## 🚀 **Getting Started**

### **1. Install the package:**
```bash
npm install @shared-infra/event-bus
```

### **2. Start using it:**
```typescript
import { eventBus } from '@shared-infra/event-bus';

// Publish events
await eventBus.publish('user.registered', { userId: '123' });

// Subscribe to events
await eventBus.subscribe('user.*', (event) => {
  console.log('User event received:', event);
});

// Send real-time updates to users
await eventBus.sendToUser('user-123', 'notification.new', {
  message: 'Your photo is ready!'
});
```

### **3. That's it!** The Event Bus handles:
- ✅ Service discovery and connection management
- ✅ Automatic reconnection and error handling
- ✅ Message serialization and validation
- ✅ Load balancing and scaling
- ✅ Security and authentication

The Event Bus Service makes real-time communication **simple, reliable, and scalable** across your entire application!
