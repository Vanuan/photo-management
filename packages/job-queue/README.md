# @shared-infra/job-queue

> Job Queue Coordinator library for photo management system - A shared infrastructure package that provides standardized job queue operations using BullMQ and Redis.

## 🎯 Overview

The Job Queue Coordinator is a **library/service layer** that backend processes use to interact with Redis/BullMQ in a standardized, managed way. It provides a clean, enterprise-grade API for job scheduling, processing, and monitoring.

### Key Features

- ✅ **Simple API** - Abstraction over BullMQ complexity
- ✅ **Standardized Patterns** - Consistent job handling across services
- ✅ **Built-in Observability** - Metrics, logging, and monitoring
- ✅ **Automatic Retries** - Configurable retry policies with backoff
- ✅ **Worker Scaling** - Dynamic worker pool management
- ✅ **Recurring Jobs** - Cron-based scheduled jobs
- ✅ **Health Checks** - Queue and worker health monitoring
- ✅ **TypeScript First** - Full type safety and IntelliSense

## 📦 Installation

```bash
npm install @shared-infra/job-queue
```

### Prerequisites

- Node.js >= 18.0.0
- Redis >= 5.0.0
- TypeScript >= 5.0.0 (if using TypeScript)

## 🚀 Quick Start

### 1. Initialize the Coordinator

```typescript
import { createJobQueueCoordinator, createSimpleConfig } from '@shared-infra/job-queue';

// Create coordinator instance
const coordinator = createJobQueueCoordinator(
  createSimpleConfig('localhost', 6379)
);

// Initialize (creates queues and workers)
await coordinator.initialize();
```

### 2. Producer: Enqueue Jobs (API Service)

```typescript
// In your API service
import { jobCoordinator } from './coordinator-instance';

app.post('/photos/upload', async (req, res) => {
  const photo = await savePhoto(req.file);

  // Enqueue photo processing job
  const job = await coordinator.enqueueJob('photo-processing', {
    photoId: photo.id,
    userId: req.user.id,
    filePath: photo.tempPath,
    operations: ['thumbnail', 'resize', 'watermark']
  });

  res.json({ 
    success: true, 
    photoId: photo.id,
    jobId: job.id 
  });
});
```

### 3. Consumer: Process Jobs (Worker Service)

```typescript
// In your worker service
import { jobCoordinator } from './coordinator-instance';

// Register worker to process jobs
await coordinator.registerWorker('photo-processing', async (job) => {
  const { photoId, filePath, operations } = job.data;

  // Update progress
  await job.updateProgress(25);
  
  // Do the actual work
  await processImage(photoId, filePath);
  
  await job.updateProgress(50);
  await generateThumbnails(photoId);
  
  await job.updateProgress(75);
  await applyWatermark(photoId);
  
  await job.updateProgress(100);

  // Return result
  return { 
    success: true, 
    photoId,
    processedOperations: operations 
  };
}, {
  concurrency: 5 // Process 5 jobs concurrently
});
```

## 📚 Core Concepts

### Queues

Queues store jobs waiting to be processed. Create queues with specific configurations:

```typescript
await coordinator.createQueue({
  name: 'photo-processing',
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    timeout: 60000
  },
  cleanupPolicy: {
    completedJobsMaxAge: 24 * 60 * 60 * 1000, // 24 hours
    failedJobsMaxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
});
```

### Workers

Workers process jobs from queues. Multiple workers can process from the same queue:

```typescript
await coordinator.registerWorker('my-queue', async (job) => {
  // Process job
  return result;
}, {
  concurrency: 10, // Process 10 jobs at once
  limiter: {
    max: 100,      // Max 100 jobs
    duration: 1000 // Per second
  }
});
```

### Job Priority

Higher priority jobs are processed first:

```typescript
await coordinator.enqueueJob('my-queue', data, {
  priority: 1  // 1 = highest priority
});
```

### Delayed Jobs

Schedule jobs to run in the future:

```typescript
await coordinator.enqueueJob('my-queue', data, {
  delay: 60000  // Run after 60 seconds
});
```

### Recurring Jobs

Schedule jobs with cron expressions:

```typescript
await coordinator.scheduleRecurringJob(
  'cleanup-queue',
  'daily-cleanup',
  { olderThanDays: 30 },
  {
    cronExpression: '0 2 * * *', // Run at 2 AM daily
    timezone: 'America/New_York'
  }
);
```

## 🔧 Configuration

### Full Configuration Example

```typescript
import { createJobQueueCoordinator } from '@shared-infra/job-queue';

const coordinator = createJobQueueCoordinator({
  redis: {
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
    keyPrefix: 'photo-app:',
    tls: {
      enabled: process.env.NODE_ENV === 'production'
    }
  },
  
  queues: [
    {
      name: 'photo-processing',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        timeout: 60000
      },
      cleanupPolicy: {
        completedJobsMaxAge: 24 * 60 * 60 * 1000,
        failedJobsMaxAge: 7 * 24 * 60 * 60 * 1000
      }
    },
    {
      name: 'batch-processing',
      defaultJobOptions: {
        attempts: 2,
        timeout: 300000 // 5 minutes
      }
    }
  ],
  
  logging: {
    level: 'info',
    format: 'json'
  },
  
  metrics: {
    enabled: true,
    collectInterval: 60000
  }
});
```

## 📊 Monitoring & Management

### Get Queue Status

```typescript
const status = await coordinator.getQueueStatus('photo-processing');

console.log(status);
// {
//   name: 'photo-processing',
//   counts: {
//     waiting: 45,
//     active: 5,
//     completed: 1230,
//     failed: 12,
//     delayed: 3
//   },
//   isPaused: false,
//   health: {
//     status: 'healthy',
//     metrics: { ... }
//   }
// }
```

### Get Health Status

```typescript
const health = await coordinator.getHealth();

console.log(health);
// {
//   status: 'healthy',
//   queues: [...],
//   workers: {
//     total: 10,
//     active: 8,
//     paused: 2
//   }
// }
```

### Manage Failed Jobs

```typescript
// Get failed jobs
const failedJobs = await coordinator.getFailedJobs('photo-processing');

// Retry a specific job
await coordinator.retryJob('photo-processing', jobId);

// Cancel a job
await coordinator.cancelJob('photo-processing', jobId);
```

### Worker Scaling

```typescript
// Scale to 10 workers
const result = await coordinator.scaleWorkers('photo-processing', 10);

console.log(result);
// {
//   success: true,
//   previousCount: 5,
//   newCount: 10,
//   message: 'Scaled up by 5 workers'
// }
```

## 🎨 Usage Patterns

### Pattern 1: Photo Processing Pipeline

```typescript
// Enqueue with pipeline config
await coordinator.enqueueNamedJob('photo-processing', 'process-photo', {
  photoId: '123',
  pipeline: {
    name: 'standard-processing',
    stages: ['thumbnail', 'resize', 'watermark', 'compress']
  },
  storage: {
    sourceKey: 'uploads/photo-123.jpg',
    bucket: 'user-uploads'
  }
});

// Worker processes pipeline
await coordinator.registerWorker('photo-processing', async (job) => {
  const { photoId, pipeline, storage } = job.data;
  
  for (const stage of pipeline.stages) {
    await job.log(`Processing stage: ${stage}`);
    await processStage(photoId, stage, storage);
    await job.updateProgress(/* ... */);
  }
  
  return { photoId, status: 'completed' };
});
```

### Pattern 2: Batch Processing

```typescript
// Enqueue batch
const jobs = photos.map(photo => ({
  name: 'process-photo',
  data: { photoId: photo.id, operations: ['resize'] }
}));

await coordinator.bulkEnqueueJobs('photo-processing', jobs);

// Track batch progress
const batchId = generateBatchId();
await coordinator.enqueueNamedJob('batch-tracking', 'track-batch', {
  batchId,
  totalJobs: jobs.length
});
```

### Pattern 3: Cleanup Jobs

```typescript
// Schedule daily cleanup
await coordinator.scheduleRecurringJob(
  'maintenance',
  'cleanup-temp-files',
  { targetDirectory: '/tmp/uploads' },
  {
    cronExpression: '0 3 * * *', // 3 AM daily
    timezone: 'UTC'
  }
);
```

## 🔒 Error Handling

### Automatic Retries

```typescript
await coordinator.enqueueJob('my-queue', data, {
  maxRetries: 5,
  backoffStrategy: {
    type: 'exponential',
    delay: 2000
  }
});
```

### Custom Error Handling

```typescript
await coordinator.registerWorker('my-queue', async (job) => {
  try {
    return await processJob(job.data);
  } catch (error) {
    await job.log(`Error: ${error.message}`);
    
    // Throw to trigger retry
    if (isRetryable(error)) {
      throw error;
    }
    
    // Mark as failed without retry
    throw new Error(`Non-retryable: ${error.message}`);
  }
});
```

## 🧪 Testing

### Test Utilities

```typescript
import { createJobQueueCoordinator } from '@shared-infra/job-queue';

describe('Photo Processing', () => {
  let coordinator;
  
  beforeAll(async () => {
    coordinator = createJobQueueCoordinator({
      redis: { host: 'localhost', port: 6379 }
    });
    await coordinator.initialize();
  });
  
  afterAll(async () => {
    await coordinator.shutdown();
  });
  
  test('should process photo successfully', async () => {
    const job = await coordinator.enqueueJob('test-queue', {
      photoId: '123'
    });
    
    expect(job.id).toBeDefined();
  });
});
```

## 📖 API Reference

### JobQueueCoordinator

#### Producer Methods

- `enqueueJob(queueName, data, options?)` - Enqueue a job
- `enqueueNamedJob(queueName, jobName, data, options?)` - Enqueue with specific name
- `bulkEnqueueJobs(queueName, jobs)` - Enqueue multiple jobs
- `scheduleRecurringJob(queueName, jobName, data, options)` - Schedule recurring job

#### Consumer Methods

- `registerWorker(queueName, processor, options?)` - Register a worker
- `scaleWorkers(queueName, targetCount)` - Scale worker count
- `pauseWorkers(queueName)` - Pause all workers for queue
- `resumeWorkers(queueName)` - Resume all workers for queue

#### Monitoring Methods

- `getQueueStatus(queueName)` - Get queue status
- `getAllQueueStatus()` - Get all queues status
- `getHealth()` - Get overall health
- `getFailedJobs(queueName, start?, end?)` - Get failed jobs
- `retryJob(queueName, jobId)` - Retry a failed job
- `cancelJob(queueName, jobId)` - Cancel a job

#### Lifecycle Methods

- `initialize()` - Initialize coordinator
- `shutdown()` - Gracefully shutdown

## 🚦 Production Deployment

### Environment Variables

```bash
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password
REDIS_DB=0
LOG_LEVEL=info
ENABLE_METRICS=true
```

### Docker Compose Example

```yaml
services:
  api:
    image: your-api:latest
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
  
  worker:
    image: your-worker:latest
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

### Graceful Shutdown

```typescript
// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await coordinator.shutdown();
  process.exit(0);
});
```

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines.

## 📄 License

MIT

## 🔗 Related Packages

- `@shared-infra/storage-core` - Storage abstractions
- `@shared-infra/storage-client` - Storage client
- `@shared-infra/storage-service` - Storage service

## 📞 Support

For questions and support, please open an issue on GitHub.