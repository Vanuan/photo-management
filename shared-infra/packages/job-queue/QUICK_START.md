# Quick Start Guide - @shared-infra/job-queue

Get up and running with the Job Queue Coordinator in 5 minutes.

## 📦 Installation

```bash
npm install @shared-infra/job-queue
```

## 🚀 Basic Setup

### 1. Start Redis (if not already running)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using docker-compose
docker-compose up -d redis
```

### 2. Create Coordinator Instance

```typescript
// coordinator.ts
import { createJobQueueCoordinator, createSimpleConfig } from '@shared-infra/job-queue';

export const coordinator = createJobQueueCoordinator(
  createSimpleConfig(
    process.env.REDIS_HOST || 'localhost',
    parseInt(process.env.REDIS_PORT || '6379')
  )
);

// Initialize on startup
export async function initJobQueue() {
  await coordinator.initialize();
  console.log('✅ Job Queue Coordinator initialized');
}
```

### 3. Create a Queue

```typescript
// queues.ts
import { coordinator } from './coordinator';

export async function setupQueues() {
  // Create photo processing queue
  await coordinator.createQueue({
    name: 'photo-processing',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      timeout: 60000, // 60 seconds
    },
  });
}
```

## 📤 Producer (API Service)

Use this in your API/web service to enqueue jobs.

```typescript
// api-service.ts
import express from 'express';
import { coordinator } from './coordinator';

const app = express();

app.post('/photos/upload', async (req, res) => {
  try {
    // 1. Save photo to storage
    const photo = await savePhotoToStorage(req.file);
    
    // 2. Enqueue processing job
    const job = await coordinator.enqueueJob('photo-processing', {
      photoId: photo.id,
      userId: req.user.id,
      operations: ['thumbnail', 'resize', 'watermark'],
    }, {
      priority: 1, // High priority
      maxRetries: 3,
    });
    
    // 3. Return response immediately
    res.json({
      success: true,
      photoId: photo.id,
      jobId: job.id,
      message: 'Photo uploaded and queued for processing',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('API service running on port 3000');
});
```

## 📥 Consumer (Worker Service)

Use this in a separate worker process/service.

```typescript
// worker-service.ts
import { coordinator } from './coordinator';
import { processPhoto, generateThumbnails, applyWatermark } from './photo-processor';

async function startWorker() {
  // Initialize coordinator
  await coordinator.initialize();
  
  // Ensure queue exists
  await coordinator.createQueue({
    name: 'photo-processing',
  });
  
  // Register worker
  await coordinator.registerWorker(
    'photo-processing',
    async (job) => {
      console.log(`📸 Processing job ${job.id}`);
      
      const { photoId, userId, operations } = job.data;
      
      try {
        // Update progress
        await job.updateProgress(0);
        await job.log(`Starting processing for photo ${photoId}`);
        
        // Process each operation
        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i];
          
          await job.log(`Processing: ${operation}`);
          
          switch (operation) {
            case 'thumbnail':
              await generateThumbnails(photoId);
              break;
            case 'resize':
              await processPhoto(photoId);
              break;
            case 'watermark':
              await applyWatermark(photoId);
              break;
          }
          
          const progress = ((i + 1) / operations.length) * 100;
          await job.updateProgress(progress);
        }
        
        await job.log('Processing completed successfully');
        
        // Return result
        return {
          success: true,
          photoId,
          userId,
          processedOperations: operations,
          completedAt: new Date().toISOString(),
        };
      } catch (error) {
        await job.log(`Error: ${error.message}`);
        throw error; // Will trigger retry
      }
    },
    {
      concurrency: 5, // Process 5 jobs at once
    }
  );
  
  console.log('✅ Worker started and processing jobs');
}

// Start worker
startWorker().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await coordinator.shutdown();
  process.exit(0);
});
```

## 🎯 Complete Example

### Directory Structure

```
my-app/
├── src/
│   ├── coordinator.ts         # Coordinator setup
│   ├── queues.ts             # Queue configurations
│   ├── api-service.ts        # Producer (API)
│   └── worker-service.ts     # Consumer (Worker)
├── package.json
└── .env
```

### Environment Variables

```bash
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password (optional)
LOG_LEVEL=info
```

### Main Application

```typescript
// index.ts
import { coordinator } from './coordinator';
import { setupQueues } from './queues';

async function main() {
  try {
    // 1. Initialize coordinator
    await coordinator.initialize();
    
    // 2. Setup queues
    await setupQueues();
    
    // 3. Start API or Worker based on process type
    if (process.env.WORKER_MODE === 'true') {
      // Start as worker
      await import('./worker-service');
    } else {
      // Start as API
      await import('./api-service');
    }
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

main();
```

### Running

```bash
# Terminal 1 - Start API service
npm start

# Terminal 2 - Start Worker service
WORKER_MODE=true npm start
```

## 🔍 Monitoring

### Check Queue Status

```typescript
// Get status of a specific queue
const status = await coordinator.getQueueStatus('photo-processing');

console.log('Queue Status:', {
  waiting: status.counts.waiting,
  active: status.counts.active,
  completed: status.counts.completed,
  failed: status.counts.failed,
  health: status.health.status,
});
```

### Check Overall Health

```typescript
const health = await coordinator.getHealth();

console.log('System Health:', {
  status: health.status,
  queues: health.queues.length,
  workers: health.workers.total,
  activeWorkers: health.workers.active,
});
```

### Monitor Failed Jobs

```typescript
// Get failed jobs
const failedJobs = await coordinator.getFailedJobs('photo-processing', 0, 10);

console.log(`Failed jobs: ${failedJobs.length}`);

// Retry a failed job
if (failedJobs.length > 0) {
  await coordinator.retryJob('photo-processing', failedJobs[0].id);
}
```

## 📊 Common Patterns

### Pattern 1: High Priority Jobs

```typescript
await coordinator.enqueueJob('photo-processing', data, {
  priority: 1, // Highest priority (1-10)
});
```

### Pattern 2: Delayed Jobs

```typescript
// Process after 5 minutes
await coordinator.enqueueJob('photo-processing', data, {
  delay: 5 * 60 * 1000, // 5 minutes in milliseconds
});
```

### Pattern 3: Recurring Jobs (Cron)

```typescript
// Run every day at 2 AM
await coordinator.scheduleRecurringJob(
  'cleanup-queue',
  'daily-cleanup',
  { olderThanDays: 7 },
  {
    cronExpression: '0 2 * * *',
    timezone: 'America/New_York',
  }
);
```

### Pattern 4: Bulk Jobs

```typescript
const jobs = photos.map(photo => ({
  name: 'process-photo',
  data: { photoId: photo.id },
}));

await coordinator.bulkEnqueueJobs('photo-processing', jobs);
```

### Pattern 5: Rate Limiting

```typescript
await coordinator.registerWorker('api-queue', processor, {
  concurrency: 10,
  limiter: {
    max: 100,      // Max 100 jobs
    duration: 1000 // Per second
  }
});
```

## 🐛 Troubleshooting

### Issue: Jobs Not Processing

**Check:**
1. Is Redis running? `redis-cli ping` should return `PONG`
2. Is worker registered? Check logs for "Worker registered"
3. Are jobs in the queue? Check queue status
4. Is worker paused? Check worker status

**Solution:**
```typescript
const status = await coordinator.getQueueStatus('photo-processing');
console.log('Queue status:', status);

const workers = coordinator.getWorkerStatus('photo-processing');
console.log('Workers:', workers);
```

### Issue: Jobs Failing Repeatedly

**Check:**
1. Error messages in failed jobs
2. Retry configuration
3. Timeout settings

**Solution:**
```typescript
const failedJobs = await coordinator.getFailedJobs('photo-processing');
failedJobs.forEach(job => {
  console.log('Failed job:', job.id, 'Error:', job.error);
});
```

### Issue: Connection Errors

**Check:**
1. Redis host/port configuration
2. Redis password (if required)
3. Network connectivity

**Solution:**
```typescript
// Test Redis connection
import Redis from 'ioredis';
const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

redis.ping().then(() => {
  console.log('✅ Redis connected');
}).catch((error) => {
  console.error('❌ Redis connection failed:', error);
});
```

## 📚 Next Steps

- Read the [full documentation](./README.md)
- Explore [architecture details](./ARCHITECTURE.md)
- Check out [advanced examples](./examples/basic-usage.ts)
- Review [API reference](./README.md#-api-reference)

## 💡 Tips

1. **Start Small**: Begin with one queue and one worker
2. **Monitor**: Use health checks and queue status regularly
3. **Scale Gradually**: Add workers as load increases
4. **Handle Errors**: Implement proper error handling in processors
5. **Test Locally**: Use Docker for local Redis instance
6. **Log Everything**: Enable debug logging during development
7. **Graceful Shutdown**: Always implement SIGTERM handler

## 🎉 You're Ready!

You now have a working job queue system. Start enqueueing jobs from your API and processing them with workers!

For more advanced features, check the full documentation.