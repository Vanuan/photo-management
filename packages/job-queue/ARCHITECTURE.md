# Job Queue Coordinator - Architecture Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Integration with BullMQ & Redis](#integration-with-bullmq--redis)
6. [Design Patterns](#design-patterns)
7. [Error Handling & Resilience](#error-handling--resilience)
8. [Scalability](#scalability)
9. [Security Considerations](#security-considerations)
10. [Monitoring & Observability](#monitoring--observability)

---

## Overview

The Job Queue Coordinator is a **library-based abstraction layer** over BullMQ and Redis that provides a standardized, enterprise-grade interface for distributed job processing in the photo management system.

### Key Characteristics

- **Library, Not Service**: Runs within your existing Node.js processes (API servers, workers)
- **BullMQ-Powered**: Built on top of BullMQ for reliable job queue operations
- **Redis-Backed**: Uses Redis for persistence, coordination, and state management
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Production-Ready**: Includes retry logic, error handling, monitoring, and scaling

### Design Philosophy

```
┌─────────────────────────────────────────────────────────┐
│  Simple API Surface                                     │
│  ↓                                                       │
│  Abstraction Layer (Job Queue Coordinator)             │
│  ↓                                                       │
│  BullMQ (Queue Engine)                                 │
│  ↓                                                       │
│  Redis (Persistence & Coordination)                    │
└─────────────────────────────────────────────────────────┘
```

---

## System Architecture

### High-Level Architecture

```
┌──────────────────────┐         ┌──────────────────────┐
│   API Service        │         │   Worker Service     │
│   (Producer)         │         │   (Consumer)         │
│                      │         │                      │
│  ┌────────────────┐  │         │  ┌────────────────┐  │
│  │ Job Coordinator│  │         │  │ Job Coordinator│  │
│  └────────┬───────┘  │         │  └────────┬───────┘  │
└───────────┼──────────┘         └───────────┼──────────┘
            │                                 │
            │        ┌────────────┐          │
            └────────►   Redis    ◄──────────┘
                     │  (BullMQ)  │
                     └────────────┘
```

### Component Architecture

```
JobQueueCoordinator
├── QueueManager (Queue lifecycle management)
│   ├── Queue creation/deletion
│   ├── Queue configuration
│   ├── Event handling
│   └── Cleanup policies
│
├── JobScheduler (Job scheduling & management)
│   ├── Job enqueueing
│   ├── Recurring jobs (cron)
│   ├── Priority management
│   ├── Delayed jobs
│   └── Bulk operations
│
└── WorkerManager (Worker lifecycle management)
    ├── Worker registration
    ├── Worker pools
    ├── Scaling operations
    ├── Health checks
    └── Event monitoring
```

---

## Core Components

### 1. QueueManager

**Responsibility**: Manages BullMQ Queue instances and their lifecycle.

```typescript
class QueueManager {
  private queues: Map<string, Queue>
  private queueEvents: Map<string, QueueEvents>
  private redis: Redis
  
  // Creates and configures BullMQ queues
  async createQueue(config: QueueConfig): Promise<Queue>
  
  // Gets queue status and health
  async getQueueStatus(name: string): Promise<QueueStatus>
  
  // Pauses/resumes queues
  async pauseQueue(name: string): Promise<void>
  async resumeQueue(name: string): Promise<void>
}
```

**Key Features**:
- Queue creation with custom configurations
- Automatic cleanup policies
- Event-driven monitoring
- Health status tracking
- Redis connection management

**Redis Keys Used**:
```
bull:{queueName}:wait         # Waiting jobs (List)
bull:{queueName}:active       # Active jobs (List)
bull:{queueName}:completed    # Completed jobs (List)
bull:{queueName}:failed       # Failed jobs (List)
bull:{queueName}:delayed      # Delayed jobs (Sorted Set)
bull:{queueName}:priority     # Priority jobs (Sorted Set)
```

### 2. JobScheduler

**Responsibility**: Handles job creation, scheduling, and lifecycle management.

```typescript
class JobScheduler {
  // Schedule one-time jobs
  async scheduleJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options?: ScheduleOptions
  ): Promise<Job<T>>
  
  // Schedule recurring jobs with cron
  async scheduleRecurringJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options: RecurringJobOptions
  ): Promise<Job<T>>
  
  // Manage job lifecycle
  async retryJob(queueName: string, jobId: string): Promise<boolean>
  async cancelJob(queueName: string, jobId: string): Promise<boolean>
  async updateJobPriority(queueName: string, jobId: string, priority: number)
}
```

**Key Features**:
- Priority-based scheduling
- Delayed execution
- Recurring jobs (cron expressions)
- Bulk job creation
- Job state management
- Retry/cancel operations

**Job Lifecycle**:
```
┌──────────┐
│ Enqueued │
└────┬─────┘
     │
     ↓
┌──────────┐    ┌─────────┐
│ Waiting  │───→│ Delayed │
└────┬─────┘    └─────────┘
     │
     ↓
┌──────────┐
│  Active  │
└────┬─────┘
     │
     ├──────→ ┌───────────┐
     │        │ Completed │
     │        └───────────┘
     │
     └──────→ ┌─────────┐
              │ Failed  │ ──→ Retry or Dead Letter
              └─────────┘
```

### 3. WorkerManager

**Responsibility**: Manages BullMQ Worker instances and worker pools.

```typescript
class WorkerManager {
  private workers: Map<string, ManagedWorker>
  private workersByQueue: Map<string, Set<string>>
  
  // Register workers to process jobs
  async registerWorker(config: WorkerConfig): Promise<ManagedWorker>
  
  // Scale worker pools
  async scaleWorkers(queueName: string, targetCount: number): Promise<ScalingResult>
  
  // Worker lifecycle
  async pauseWorker(workerId: string): Promise<void>
  async resumeWorker(workerId: string): Promise<void>
  async closeWorker(workerId: string): Promise<void>
}
```

**Key Features**:
- Worker registration with custom processors
- Concurrency control
- Rate limiting
- Worker pool management
- Dynamic scaling
- Health monitoring
- Stalled job detection

**Worker Pool Pattern**:
```
Queue: photo-processing
├── Worker-1 (concurrency: 5)
│   ├── Job 1
│   ├── Job 2
│   ├── Job 3
│   ├── Job 4
│   └── Job 5
├── Worker-2 (concurrency: 5)
│   ├── Job 6
│   ├── Job 7
│   └── ...
└── Worker-3 (concurrency: 5)
    └── ...
```

---

## Data Flow

### Producer Flow (Enqueueing Jobs)

```
API Request
    ↓
coordinator.enqueueJob(queueName, data, options)
    ↓
JobScheduler.scheduleJob()
    ↓
BullMQ Queue.add()
    ↓
Redis LPUSH/ZADD (depending on priority/delay)
    ↓
Job ID returned to caller
```

**Example**:
```typescript
// API Service
const job = await coordinator.enqueueJob('photo-processing', {
  photoId: '123',
  operation: 'thumbnail'
}, {
  priority: 1,
  maxRetries: 3
});

// Redis Operations:
// 1. HSET bull:photo-processing:job-123 { name, data, opts, timestamp }
// 2. ZADD bull:photo-processing:priority 1 job-123
// 3. HINCRBY bull:photo-processing:metrics waiting 1
```

### Consumer Flow (Processing Jobs)

```
Worker Registered
    ↓
BullMQ Worker polls Redis
    ↓
RPOPLPUSH wait → active (atomic)
    ↓
Job claimed by worker
    ↓
Processor function executed
    ↓
Success → LREM active, LPUSH completed
Failure → LREM active, LPUSH failed (or retry)
```

**Example**:
```typescript
// Worker Service
await coordinator.registerWorker('photo-processing', async (job) => {
  // Process job
  await processPhoto(job.data.photoId);
  return { success: true };
});

// Redis Operations:
// 1. RPOPLPUSH bull:photo-processing:wait → bull:photo-processing:active
// 2. HSET bull:photo-processing:job-123 processedOn timestamp
// 3. Process...
// 4. LREM bull:photo-processing:active job-123
// 5. LPUSH bull:photo-processing:completed job-123
```

---

## Integration with BullMQ & Redis

### BullMQ Integration

The Job Queue Coordinator **wraps** BullMQ, not replaces it:

```typescript
// Internal: QueueManager creates BullMQ Queue
const queue = new Queue(name, {
  connection: this.redis.duplicate(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  }
});

// Internal: WorkerManager creates BullMQ Worker
const worker = new Worker(queueName, processor, {
  connection: redis.duplicate(),
  concurrency: 5,
  limiter: { max: 100, duration: 1000 }
});
```

**What BullMQ Provides**:
- ✅ Queue data structures and operations
- ✅ Job persistence and state management
- ✅ Worker coordination and job claiming
- ✅ Event system (completed, failed, stalled)
- ✅ Retry logic with backoff strategies
- ✅ Rate limiting
- ✅ Delayed and recurring jobs

**What Coordinator Adds**:
- ✅ Simplified, consistent API
- ✅ Lifecycle management (init, shutdown)
- ✅ Health monitoring and metrics
- ✅ Worker pool management
- ✅ Dynamic scaling
- ✅ Enhanced logging and observability
- ✅ Type-safe interfaces

### Redis Data Model

**Queue State**:
```redis
# Job data (Hash)
HSET bull:photo-processing:123 
  name "process-photo"
  data '{"photoId":"123"}'
  opts '{"attempts":3}'
  timestamp 1640995200000

# Waiting queue (List - FIFO)
LPUSH bull:photo-processing:wait "123" "124" "125"

# Active jobs (List)
LPUSH bull:photo-processing:active "126"

# Delayed jobs (Sorted Set - score = timestamp)
ZADD bull:photo-processing:delayed 1640999999000 "127"

# Priority jobs (Sorted Set - score = priority)
ZADD bull:photo-processing:priority 1 "128"

# Completed jobs (List - limited size)
LPUSH bull:photo-processing:completed "129" "130"
LTRIM bull:photo-processing:completed 0 999

# Failed jobs (List)
LPUSH bull:photo-processing:failed "131"
```

**Atomic Operations**:
```lua
-- BullMQ uses Lua scripts for atomic operations
-- Example: Moving job from wait to active
local jobId = redis.call('RPOPLPUSH', KEYS[1], KEYS[2])
redis.call('HSET', KEYS[3], 'processedOn', ARGV[1])
return jobId
```

---

## Design Patterns

### 1. Facade Pattern

The Coordinator acts as a **facade** over BullMQ complexity:

```typescript
// Without Coordinator (BullMQ directly)
const queue = new Queue('my-queue', { connection: redis });
const worker = new Worker('my-queue', processor, { connection: redis });
queue.add('job', data, { attempts: 3, backoff: {...} });
worker.on('completed', ...);
worker.on('failed', ...);
// Manual cleanup, health checks, etc.

// With Coordinator (Simple)
await coordinator.createQueue({ name: 'my-queue' });
await coordinator.registerWorker('my-queue', processor);
await coordinator.enqueueJob('my-queue', data);
// Health checks, cleanup, monitoring built-in
```

### 2. Manager Pattern

Each core component is a **manager** for its domain:

- `QueueManager` manages queues
- `JobScheduler` manages jobs
- `WorkerManager` manages workers

### 3. Event-Driven Architecture

Heavy use of events for decoupling:

```typescript
// Queue events
queue.on('completed', handleCompleted);
queue.on('failed', handleFailed);

// Worker events
worker.on('active', handleActive);
worker.on('stalled', handleStalled);

// Coordinator propagates and enhances events
```

### 4. Repository Pattern

Coordinators act as repositories for their entities:

```typescript
// Queue repository
queueManager.getQueue(name)
queueManager.getQueueNames()
queueManager.getQueueStatus(name)

// Worker repository
workerManager.getWorker(id)
workerManager.getWorkersByQueue(queueName)
workerManager.getAllWorkerStatus()
```

---

## Error Handling & Resilience

### Retry Strategy

```typescript
// Configurable retry with backoff
await coordinator.enqueueJob('my-queue', data, {
  maxRetries: 5,
  backoffStrategy: {
    type: 'exponential',  // or 'fixed'
    delay: 2000           // initial delay
  }
});

// Retry sequence: 0s, 2s, 4s, 8s, 16s
```

### Error Classification

```typescript
// In worker processor
try {
  await processJob(job.data);
} catch (error) {
  if (isRetryable(error)) {
    throw error;  // Will be retried
  } else {
    throw new Error('FATAL: ' + error.message);  // Won't retry
  }
}
```

### Dead Letter Handling

Failed jobs after max retries can be:
- Stored for manual review
- Moved to dead-letter queue
- Logged for analysis

```typescript
const failedJobs = await coordinator.getFailedJobs('my-queue');
await coordinator.retryJob('my-queue', failedJob.id);
```

### Circuit Breaker (Future)

Prevent cascading failures:
```
Open → Half-Open → Closed
  ↑                  ↓
  └──────────────────┘
```

---

## Scalability

### Horizontal Scaling

**Multiple Workers per Queue**:
```
Queue: photo-processing
├── Worker Instance 1 (5 concurrent)
├── Worker Instance 2 (5 concurrent)
├── Worker Instance 3 (5 concurrent)
└── Worker Instance N (5 concurrent)
    = Total: N × 5 concurrent jobs
```

**Deployment Pattern**:
```yaml
# Kubernetes example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: photo-worker
spec:
  replicas: 10  # Scale to 10 worker pods
  template:
    spec:
      containers:
      - name: worker
        # Each pod runs coordinator.registerWorker()
```

### Dynamic Scaling

```typescript
// Monitor queue depth
const status = await coordinator.getQueueStatus('photo-processing');

if (status.counts.waiting > 1000) {
  // Scale up
  await coordinator.scaleWorkers('photo-processing', 10);
} else if (status.counts.waiting < 100) {
  // Scale down
  await coordinator.scaleWorkers('photo-processing', 3);
}
```

### Rate Limiting

```typescript
await coordinator.registerWorker('my-queue', processor, {
  concurrency: 10,
  limiter: {
    max: 100,      // Max 100 jobs
    duration: 1000 // Per second
  }
});
// Prevents overwhelming downstream services
```

---

## Security Considerations

### Input Validation

```typescript
// Validate job data before enqueueing
if (!isValidJobData(data)) {
  throw new Error('Invalid job data');
}

// Size limits
const MAX_JOB_SIZE = 10 * 1024 * 1024; // 10MB
if (JSON.stringify(data).length > MAX_JOB_SIZE) {
  throw new Error('Job data too large');
}
```

### Redis Security

```typescript
redis: {
  host: 'redis.example.com',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  tls: {
    enabled: true,
    ca: fs.readFileSync('/path/to/ca.crt')
  }
}
```

### Access Control (Future)

```typescript
// Job-level permissions
const canEnqueue = await checkPermission(user, 'enqueue', queueName);
if (!canEnqueue) {
  throw new UnauthorizedError();
}
```

---

## Monitoring & Observability

### Metrics Collection

```typescript
// Built-in metrics
const status = await coordinator.getQueueStatus('my-queue');

console.log({
  waiting: status.counts.waiting,
  active: status.counts.active,
  completed: status.counts.completed,
  failed: status.counts.failed,
  errorRate: status.health.metrics.errorRate,
  throughput: status.health.metrics.throughput,
  avgProcessingTime: status.health.metrics.averageProcessingTime
});
```

### Health Checks

```typescript
const health = await coordinator.getHealth();

if (health.status === 'unhealthy') {
  // Alert operations team
  sendAlert('Job queue unhealthy', health);
}
```

### Logging

```typescript
// Structured logging built-in
coordinator.enqueueJob(...)  // Logs: "Job enqueued: id=123 queue=my-queue"
worker processes job         // Logs: "Processing job 123"
job completes               // Logs: "Job 123 completed in 1500ms"
```

### Tracing

```typescript
// Trace IDs for distributed tracing
const job = await coordinator.enqueueJob('my-queue', {
  traceId: generateTraceId(),
  ...data
});

// Worker logs include trace ID
await coordinator.registerWorker('my-queue', async (job) => {
  const { traceId } = job.data;
  logger.info('Processing', { traceId });
});
```

---

## Deployment Considerations

### Environment Variables

```bash
REDIS_HOST=redis.prod.example.com
REDIS_PORT=6379
REDIS_PASSWORD=secure-password
REDIS_DB=0
LOG_LEVEL=info
WORKER_CONCURRENCY=5
MAX_JOB_RETRIES=3
```

### Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await coordinator.shutdown();  // Closes workers, waits for active jobs
  process.exit(0);
});
```

### Resource Management

```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

---

## Future Enhancements

1. **Auto-scaling**: Automatic worker scaling based on queue depth
2. **Circuit Breaker**: Prevent cascading failures
3. **Job Prioritization**: Advanced priority algorithms
4. **Job Dependencies**: Chain jobs with dependencies
5. **Saga Pattern**: Multi-step transactions with rollback
6. **Metrics Export**: Prometheus, Grafana integration
7. **Admin UI**: Web-based queue monitoring
8. **Job Scheduling**: Advanced scheduling (date ranges, conditions)

---

## Conclusion

The Job Queue Coordinator provides a **production-ready, type-safe, scalable** foundation for distributed job processing in the photo management system. By abstracting BullMQ and Redis complexity, it enables teams to focus on business logic while maintaining enterprise-grade reliability and observability.

### Key Takeaways

✅ **Simple API** over complex infrastructure  
✅ **BullMQ-powered** for reliability  
✅ **Redis-backed** for persistence  
✅ **Type-safe** with TypeScript  
✅ **Production-ready** with monitoring and error handling  
✅ **Scalable** horizontally and vertically  
✅ **Observable** with built-in logging and metrics  
