# Job Queue Coordinator - Design Document

## Table of Contents

- [1. Overview](#1-overview)
- [2. Architecture](#2-architecture)
- [3. Core Components](#3-core-components)
- [4. Job Types & Schemas](#4-job-types--schemas)
- [5. Queue Management](#5-queue-management)
- [6. Worker Management](#6-worker-management)
- [7. Error Handling & Resilience](#7-error-handling--resilience)
- [8. Monitoring & Observability](#8-monitoring--observability)
- [9. Performance & Scaling](#9-performance--scaling)
- [10. Security](#10-security)
- [11. Configuration](#11-configuration)
- [12. Implementation Guidelines](#12-implementation-guidelines)

---

## 1. Overview

### 1.1 Purpose

The Job Queue Coordinator serves as the **central message routing and job orchestration** component within the Shared Infrastructure Layer. It manages the lifecycle of asynchronous jobs, provides reliable message delivery, and coordinates work distribution across processing workers.

### 1.2 Key Responsibilities

- **Job Lifecycle Management**: Enqueue, schedule, execute, retry, and complete jobs
- **Queue Orchestration**: Create, configure, and manage multiple job queues
- **Worker Coordination**: Distribute work across available workers with load balancing
- **Priority Scheduling**: Handle job prioritization and deadline management
- **Retry & Dead Letter Handling**: Implement sophisticated retry policies and failure management
- **Resource Management**: Monitor and optimize queue performance and worker utilization

### 1.3 Technology Stack

- **Core Engine**: BullMQ (Redis-based job queue)
- **Message Broker**: Redis with persistence
- **Monitoring**: Custom metrics collection with Prometheus integration
- **Security**: JWT-based authentication and rate limiting

---

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    JOB QUEUE COORDINATOR                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │   Queue         │  │   Job           │  │   Worker        │      │
│  │   Manager       │  │   Scheduler     │  │   Manager       │      │
│  │                 │  │                 │  │                 │      │
│  │ • Queue Config  │  │ • Priority      │  │ • Worker Pool   │      │
│  │ • Lifecycle     │  │   Handling      │  │ • Load Balance  │      │
│  │ • Monitoring    │  │ • Delayed Jobs  │  │ • Health Check  │      │
│  │ • Cleanup       │  │ • Recurring     │  │ • Auto-scaling  │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│           │                     │                     │              │
│           └─────────────────────┼─────────────────────┘              │
│                                 │                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │   Retry &       │  │   Dead Letter   │  │   Metrics &     │      │
│  │   Backoff       │  │   Handler       │  │   Monitoring    │      │
│  │                 │  │                 │  │                 │      │
│  │ • Exponential   │  │ • Failed Jobs   │  │ • Performance   │      │
│  │   Backoff       │  │ • Manual Review │  │   Metrics       │      │
│  │ • Jitter        │  │ • Requeue       │  │ • Health Status │      │
│  │ • Circuit       │  │   Options       │  │ • Alerting      │      │
│  │   Breakers      │  │ • Archival      │  │ • Tracing       │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                              ┌─────────────┐
                              │    Redis    │
                              │   Cluster   │
                              │             │
                              │ • Queues    │
                              │ • Jobs      │
                              │ • State     │
                              │ • Locks     │
                              │ • Metrics   │
                              └─────────────┘
```

### 2.2 Component Interactions

```typescript
interface JobQueueCoordinator {
  // Core Interfaces
  queueManager: QueueManager;
  jobScheduler: JobScheduler;
  workerManager: WorkerManager;
  retryHandler: RetryHandler;
  deadLetterHandler: DeadLetterHandler;
  metricsCollector: MetricsCollector;
  
  // Lifecycle Methods
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Queue Operations
  createQueue(config: QueueConfig): Promise<Queue>;
  enqueueJob<T>(queueName: string, jobData: T, options?: JobOptions): Promise<Job<T>>;
  
  // Worker Operations
  registerWorker(queueName: string, processor: JobProcessor): Promise<Worker>;
  
  // Monitoring
  getStatus(): Promise<CoordinatorStatus>;
}
```

---

## 3. Core Components

### 3.1 Queue Manager

The Queue Manager handles the creation, configuration, and lifecycle management of job queues.

```typescript
interface QueueManager {
  createQueue(name: string, config: QueueConfig): Promise<Queue>;
  getQueue(name: string): Queue | null;
  getAllQueues(): Map<string, Queue>;
  destroyQueue(name: string): Promise<void>;
  pauseQueue(name: string): Promise<void>;
  resumeQueue(name: string): Promise<void>;
  getQueueStatus(name: string): Promise<QueueStatus>;
}

class QueueManagerImpl implements QueueManager {
  private queues: Map<string, Queue> = new Map();
  private redis: Redis;
  private config: QueueManagerConfig;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(
    redisConnection: Redis,
    config: QueueManagerConfig,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.redis = redisConnection;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }
  
  async createQueue(name: string, config: QueueConfig): Promise<Queue> {
    if (this.queues.has(name)) {
      throw new Error(`Queue '${name}' already exists`);
    }
    
    const queueOptions: QueueOptions = {
      connection: this.redis,
      defaultJobOptions: {
        ...this.config.defaultJobOptions,
        ...config.defaultJobOptions
      },
      settings: {
        stalledInterval: config.stalledInterval || 30000,
        retryProcessDelay: config.retryProcessDelay || 5000,
        maxStalledCount: config.maxStalledCount || 1
      }
    };
    
    const queue = new Queue(name, queueOptions);
    
    // Setup event handlers
    this.setupQueueEventHandlers(queue, name);
    
    // Setup cleanup job
    await this.setupQueueCleanup(queue, config);
    
    this.queues.set(name, queue);
    
    this.logger.info(`Queue created`, { 
      name, 
      options: queueOptions 
    });
    
    this.metrics.incrementCounter('queues_created_total', { queue: name });
    
    return queue;
  }
  
  private setupQueueEventHandlers(queue: Queue, name: string): void {
    queue.on('error', (error) => {
      this.logger.error(`Queue error`, { 
        queue: name, 
        error: error.message 
      });
      
      this.metrics.incrementCounter('queue_errors_total', { 
        queue: name,
        error_type: error.constructor.name 
      });
    });
    
    queue.on('paused', () => {
      this.logger.info(`Queue paused`, { queue: name });
      this.metrics.setGauge('queue_paused', 1, { queue: name });
    });
    
    queue.on('resumed', () => {
      this.logger.info(`Queue resumed`, { queue: name });
      this.metrics.setGauge('queue_paused', 0, { queue: name });
    });
    
    queue.on('cleaned', (jobs, type) => {
      this.logger.info(`Queue cleaned`, { 
        queue: name, 
        jobsCount: jobs.length, 
        type 
      });
      
      this.metrics.incrementCounter('queue_jobs_cleaned_total', { 
        queue: name, 
        type 
      });
    });
  }
  
  private async setupQueueCleanup(queue: Queue, config: QueueConfig): Promise<void> {
    if (config.cleanup?.enabled) {
      // Setup automatic cleanup of completed and failed jobs
      const cleanupOptions = {
        removeOnComplete: config.cleanup.removeOnComplete || 100,
        removeOnFail: config.cleanup.removeOnFail || 50
      };
      
      // Schedule periodic cleanup
      setInterval(async () => {
        try {
          await queue.clean(
            config.cleanup.completedJobAge || 24 * 60 * 60 * 1000, // 24 hours
            100,
            'completed'
          );
          
          await queue.clean(
            config.cleanup.failedJobAge || 7 * 24 * 60 * 60 * 1000, // 7 days
            50,
            'failed'
          );
        } catch (error) {
          this.logger.error(`Queue cleanup failed`, { 
            queue: queue.name, 
            error: error.message 
          });
        }
      }, config.cleanup.interval || 60 * 60 * 1000); // 1 hour
    }
  }
}

interface QueueConfig {
  name: string;
  concurrency?: number;
  rateLimit?: {
    max: number;
    duration: number;
  };
  defaultJobOptions?: Partial<JobOptions>;
  stalledInterval?: number;
  retryProcessDelay?: number;
  maxStalledCount?: number;
  cleanup?: {
    enabled: boolean;
    removeOnComplete?: number;
    removeOnFail?: number;
    completedJobAge?: number;
    failedJobAge?: number;
    interval?: number;
  };
}

interface QueueStatus {
  name: string;
  isPaused: boolean;
  jobCounts: {
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  workers: number;
  processingRate: number;
  averageProcessingTime: number;
}
```

### 3.2 Job Scheduler

The Job Scheduler handles job prioritization, scheduling, and delayed execution.

```typescript
interface JobScheduler {
  scheduleJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options: ScheduleOptions
  ): Promise<Job<T>>;
  
  scheduleRecurringJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    cronExpression: string,
    options?: RecurringJobOptions
  ): Promise<RepeatableJob>;
  
  cancelScheduledJob(queueName: string, jobId: string): Promise<void>;
  getScheduledJobs(queueName: string): Promise<Job[]>;
  updateJobPriority(queueName: string, jobId: string, priority: number): Promise<void>;
}

class JobSchedulerImpl implements JobScheduler {
  private queueManager: QueueManager;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(
    queueManager: QueueManager,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.queueManager = queueManager;
    this.logger = logger;
    this.metrics = metrics;
  }
  
  async scheduleJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options: ScheduleOptions
  ): Promise<Job<T>> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }
    
    const jobOptions: JobOptions = {
      priority: options.priority || 0,
      delay: options.delayMs || 0,
      attempts: options.maxRetries || 3,
      backoff: options.backoffStrategy || {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: options.removeOnComplete,
      removeOnFail: options.removeOnFail,
      jobId: options.jobId,
      
      // Add metadata for tracking
      data: {
        ...data,
        _metadata: {
          scheduledAt: Date.now(),
          scheduledBy: 'job-scheduler',
          traceId: options.traceId || this.generateTraceId(),
          version: '1.0.0'
        }
      }
    };
    
    const job = await queue.add(jobName, data, jobOptions);
    
    this.logger.info(`Job scheduled`, {
      queueName,
      jobName,
      jobId: job.id,
      priority: options.priority,
      delayMs: options.delayMs,
      traceId: options.traceId
    });
    
    this.metrics.incrementCounter('jobs_scheduled_total', {
      queue: queueName,
      job_type: jobName,
      priority: String(options.priority || 0)
    });
    
    if (options.delayMs && options.delayMs > 0) {
      this.metrics.incrementCounter('jobs_delayed_total', {
        queue: queueName,
        job_type: jobName
      });
    }
    
    return job;
  }
  
  async scheduleRecurringJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    cronExpression: string,
    options: RecurringJobOptions = {}
  ): Promise<RepeatableJob> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }
    
    // Validate cron expression
    if (!this.isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }
    
    const jobOptions: JobOptions = {
      repeat: {
        cron: cronExpression,
        tz: options.timezone || 'UTC',
        startDate: options.startDate,
        endDate: options.endDate,
        limit: options.maxRuns
      },
      priority: options.priority || 0,
      attempts: options.maxRetries || 3,
      backoff: options.backoffStrategy || {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: options.removeOnComplete || 10,
      removeOnFail: options.removeOnFail || 5
    };
    
    const job = await queue.add(jobName, data, jobOptions);
    
    this.logger.info(`Recurring job scheduled`, {
      queueName,
      jobName,
      cronExpression,
      timezone: options.timezone,
      maxRuns: options.maxRuns
    });
    
    this.metrics.incrementCounter('recurring_jobs_scheduled_total', {
      queue: queueName,
      job_type: jobName
    });
    
    return {
      id: job.id!,
      name: jobName,
      data,
      cronExpression,
      options: jobOptions,
      nextRun: this.calculateNextRun(cronExpression, options.timezone)
    };
  }
  
  async updateJobPriority(
    queueName: string,
    jobId: string,
    priority: number
  ): Promise<void> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }
    
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found in queue '${queueName}'`);
    }
    
    await job.changePriority(priority);
    
    this.logger.info(`Job priority updated`, {
      queueName,
      jobId,
      oldPriority: job.opts.priority,
      newPriority: priority
    });
    
    this.metrics.incrementCounter('job_priority_changes_total', {
      queue: queueName,
      job_type: job.name
    });
  }
  
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  private isValidCronExpression(expression: string): boolean {
    // Basic cron validation - in production, use a proper cron parser
    const cronRegex = /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([01]?\d|3[01])) (\*|(1[0-2]|0?[1-9])) (\*|([0-6]))$/;
    return cronRegex.test(expression);
  }
  
  private calculateNextRun(cronExpression: string, timezone?: string): Date {
    // Implementation would use a cron parser library like node-cron
    // For now, return a placeholder
    return new Date(Date.now() + 60000); // Next minute
  }
}

interface ScheduleOptions {
  priority?: number;
  delayMs?: number;
  maxRetries?: number;
  backoffStrategy?: BackoffOptions;
  removeOnComplete?: number | boolean;
  removeOnFail?: number | boolean;
  jobId?: string;
  traceId?: string;
}

interface RecurringJobOptions {
  priority?: number;
  maxRetries?: number;
  backoffStrategy?: BackoffOptions;
  removeOnComplete?: number;
  removeOnFail?: number;
  timezone?: string;
  startDate?: Date;
  endDate?: Date;
  maxRuns?: number;
}

interface RepeatableJob {
  id: string;
  name: string;
  data: any;
  cronExpression: string;
  options: JobOptions;
  nextRun: Date;
}

interface BackoffOptions {
  type: 'fixed' | 'exponential';
  delay: number;
  maxDelay?: number;
}
```

### 3.3 Worker Manager

The Worker Manager handles worker registration, load balancing, and health monitoring.

```typescript
interface WorkerManager {
  registerWorker(
    queueName: string,
    processor: JobProcessor,
    options?: WorkerOptions
  ): Promise<Worker>;
  
  unregisterWorker(workerId: string): Promise<void>;
  getWorkers(queueName?: string): Worker[];
  getWorkerStatus(workerId: string): Promise<WorkerStatus>;
  scaleWorkers(queueName: string, targetCount: number): Promise<ScalingResult>;
  pauseWorker(workerId: string): Promise<void>;
  resumeWorker(workerId: string): Promise<void>;
}

class WorkerManagerImpl implements WorkerManager {
  private workers: Map<string, ManagedWorker> = new Map();
  private workersByQueue: Map<string, Set<string>> = new Map();
  private queueManager: QueueManager;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(
    queueManager: QueueManager,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.queueManager = queueManager;
    this.logger = logger;
    this.metrics = metrics;
    
    // Setup periodic health checks
    this.setupHealthChecks();
  }
  
  async registerWorker(
    queueName: string,
    processor: JobProcessor,
    options: WorkerOptions = {}
  ): Promise<Worker> {
    const workerId = this.generateWorkerId(queueName);
    
    const workerOptions: BullWorkerOptions = {
      connection: options.connection,
      concurrency: options.concurrency || 1,
      limiter: options.rateLimiter ? {
        max: options.rateLimiter.max,
        duration: options.rateLimiter.duration
      } : undefined,
      settings: {
        stalledInterval: options.stalledInterval || 30000,
        maxStalledCount: options.maxStalledCount || 1
      }
    };
    
    const worker = new Worker(queueName, async (job) => {
      const startTime = Date.now();
      
      try {
        // Add job processing metadata
        const processingContext: JobProcessingContext = {
          workerId,
          queueName,
          jobId: job.id!,
          attemptNumber: job.attemptsMade + 1,
          startTime
        };
        
        // Execute the processor
        const result = await processor(job, processingContext);
        
        // Record success metrics
        const duration = Date.now() - startTime;
        this.recordJobSuccess(queueName, job.name, duration, workerId);
        
        return result;
        
      } catch (error) {
        // Record failure metrics
        const duration = Date.now() - startTime;
        this.recordJobFailure(queueName, job.name, duration, workerId, error);
        
        throw error;
      }
    }, workerOptions);
    
    // Setup worker event handlers
    this.setupWorkerEventHandlers(worker, workerId, queueName);
    
    // Store managed worker
    const managedWorker: ManagedWorker = {
      id: workerId,
      worker,
      queueName,
      processor,
      options,
      status: 'active',
      registeredAt: new Date(),
      lastActivity: new Date(),
      processedJobs: 0,
      failedJobs: 0
    };
    
    this.workers.set(workerId, managedWorker);
    
    // Track by queue
    if (!this.workersByQueue.has(queueName)) {
      this.workersByQueue.set(queueName, new Set());
    }
    this.workersByQueue.get(queueName)!.add(workerId);
    
    this.logger.info(`Worker registered`, {
      workerId,
      queueName,
      concurrency: options.concurrency
    });
    
    this.metrics.incrementCounter('workers_registered_total', {
      queue: queueName
    });
    
    this.metrics.setGauge('active_workers', this.getActiveWorkerCount(), {
      queue: queueName
    });
    
    return worker;
  }
  
  async scaleWorkers(
    queueName: string,
    targetCount: number
  ): Promise<ScalingResult> {
    const currentWorkers = this.workersByQueue.get(queueName) || new Set();
    const currentCount = currentWorkers.size;
    
    if (targetCount === currentCount) {
      return {
        queueName,
        previousCount: currentCount,
        targetCount,
        actualCount: currentCount,
        action: 'no_change'
      };
    }
    
    let actualCount = currentCount;
    
    if (targetCount > currentCount) {
      // Scale up - create new workers
      const workersToCreate = targetCount - currentCount;
      const queue = this.queueManager.getQueue(queueName);
      
      if (!queue) {
        throw new Error(`Queue '${queueName}' not found`);
      }
      
      // Get a reference processor from existing worker or use default
      const existingWorker = currentWorkers.size > 0 ? 
        this.workers.get(Array.from(currentWorkers)[0]) : null;
      
      const referenceProcessor = existingWorker?.processor || this.getDefaultProcessor();
      const referenceOptions = existingWorker?.options || {};
      
      for (let i = 0; i < workersToCreate; i++) {
        try {
          await this.registerWorker(queueName, referenceProcessor, referenceOptions);
          actualCount++;
        } catch (error) {
          this.logger.error(`Failed to create worker during scale-up`, {
            queueName,
            error: error.message
          });
          break;
        }
      }
      
      this.logger.info(`Scaled up workers`, {
        queueName,
        from: currentCount,
        to: actualCount
      });
      
    } else {
      // Scale down - remove workers
      const workersToRemove = currentCount - targetCount;
      const workerIds = Array.from(currentWorkers);
      
      for (let i = 0; i < workersToRemove && i < workerIds.length; i++) {
        try {
          await this.unregisterWorker(workerIds[i]);
          actualCount--;
        } catch (error) {
          this.logger.error(`Failed to remove worker during scale-down`, {
            workerId: workerIds[i],
            error: error.message
          });
          break;
        }
      }
      
      this.logger.info(`Scaled down workers`, {
        queueName,
        from: currentCount,
        to: actualCount
      });
    }
    
    this.metrics.recordHistogram('worker_scaling_events', actualCount - currentCount, {
      queue: queueName,
      action: targetCount > currentCount ? 'scale_up' : 'scale_down'
    });
    
    return {
      queueName,
      previousCount: currentCount,
      targetCount,
      actualCount,
      action: actualCount > currentCount ? 'scaled_up' : 
              actualCount < currentCount ? 'scaled_down' : 'no_change'
    };
  }
  
  private setupWorkerEventHandlers(
    worker: Worker,
    workerId: string,
    queueName: string
  ): void {
    worker.on('completed', (job, result) => {
      const managedWorker = this.workers.get(workerId);
      if (managedWorker) {
        managedWorker.processedJobs++;
        managedWorker.lastActivity = new Date();
      }
      
      this.logger.debug(`Job completed`, {
        workerId,
        queueName,
        jobId: job.id,
        jobType: job.name,
        duration: Date.now() - job.processedOn!
      });
    });
    
    worker.on('failed', (job, error) => {
      const managedWorker = this.workers.get(workerId);
      if (managedWorker) {
        managedWorker.failedJobs++;
        managedWorker.lastActivity = new Date();
      }
      
      this.logger.error(`Job failed`, {
        workerId,
        queueName,
        jobId: job.id,
        jobType: job.name,
        error: error.message,
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts
      });
    });
    
    worker.on('stalled', (jobId) => {
      this.logger.warn(`Job stalled`, {
        workerId,
        queueName,
        jobId
      });
      
      this.metrics.incrementCounter('jobs_stalled_total', {
        queue: queueName,
        worker: workerId
      });
    });
    
    worker.on('error', (error) => {
      this.logger.error(`Worker error`, {
        workerId,
        queueName,
        error: error.message
      });
      
      const managedWorker = this.workers.get(workerId);
      if (managedWorker) {
        managedWorker.status = 'error';
      }
      
      this.metrics.incrementCounter('worker_errors_total', {
        queue: queueName,
        worker: workerId,
        error_type: error.constructor.name
      });
    });
  }
  
  private recordJobSuccess(
    queueName: string,
    jobType: string,
    duration: number,
    workerId: string
  ): void {
    this.metrics.incrementCounter('jobs_completed_total', {
      queue: queueName,
      job_type: jobType,
      worker: workerId
    });
    
    this.metrics.recordHistogram('job_processing_duration_ms', duration, {
      queue: queueName,
      job_type: jobType,
      worker: workerId
    });
  }
  
  private recordJobFailure(
    queueName: string,
    jobType: string,
    duration: number,
    workerId: string,
    error: Error
  ): void {
    this.metrics.incrementCounter('jobs_failed_total', {
      queue: queueName,
      job_type: jobType,
      worker: workerId,
      error_type: error.constructor.name
    });
    
    this.metrics.recordHistogram('job_processing_duration_ms', duration, {
      queue: queueName,
      job_type: jobType,
      worker: workerId,
      status: 'failed'
    });
  }
  
  private setupHealthChecks(): void {
    setInterval(() => {
      this.checkWorkerHealth();
    }, 30000); // Check every 30 seconds
  }
  
  private async checkWorkerHealth(): Promise<void> {
    const now = new Date();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (const [workerId, managedWorker] of this.workers.entries()) {
      const timeSinceActivity = now.getTime() - managedWorker.lastActivity.getTime();
      
      if (timeSinceActivity > staleThreshold && managedWorker.status === 'active') {
        this.logger.warn(`Worker appears stale`, {
          workerId,
          queueName: managedWorker.queueName,
          timeSinceActivity
        });
        
        managedWorker.status = 'stale';
        
        this.metrics.incrementCounter('workers_stale_total', {
          queue: managedWorker.queueName
        });
      }
    }
  }
  
  private getActiveWorkerCount(queueName?: string): number {
    if (queueName) {
      const queueWorkers = this.workersByQueue.get(queueName);
      return queueWorkers ? queueWorkers.size : 0;
    }
    
    return Array.from(this.workers.values())
      .filter(w => w.status === 'active').length;
  }
  
  private generateWorkerId(queueName: string): string {
    return `worker_${queueName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  private getDefaultProcessor(): JobProcessor {
    return async (job: Job) => {
      throw new Error(`No processor registered for job type: ${job.name}`);
    };
  }
}

interface ManagedWorker {
  id: string;
  worker: Worker;
  queueName: string;
  processor: JobProcessor;
  options: WorkerOptions;
  status: 'active' | 'paused' | 'error' | 'stale';
  registeredAt: Date;
  lastActivity: Date;
  processedJobs: number;
  failedJobs: number;
}

interface WorkerOptions {
  concurrency?: number;
  connection?: any;
  rateLimiter?: {
    max: number;
    duration: number;
  };
  stalledInterval?: number;
  maxStalledCount?: number;
}

interface WorkerStatus {
  id: string;
  queueName: string;
  status: 'active' | 'paused' | 'error' | 'stale';
  processedJobs: number;
  failedJobs: number;
  uptime: number;
  lastActivity: Date;
}

interface ScalingResult {
  queueName: string;
  previousCount: number;
  targetCount: number;
  actualCount: number;
  action: 'scaled_up' | 'scaled_down' | 'no_change';
}

interface JobProcessingContext {
  workerId: string;
  queueName: string;
  jobId: string;
  attemptNumber: number;
  startTime: number;
}

type JobProcessor = (job: Job, context?: JobProcessingContext) => Promise<any>;
```

---

## 4. Job Types & Schemas

### 4.1 Core Job Types

```typescript
// Photo Processing Job Schema
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

// Batch Processing Job Schema
interface BatchProcessingJob {
  id: string;
  batchId: string;
  photoIds: string[];
  batchSize: number;
  pipeline: string;
  clientId: string;
  priority: number;
  metadata: {
    totalPhotos: number;
    estimatedDuration: number;
    createdAt: string;
  };
}

// Cleanup Job Schema
interface CleanupJob {
  id: string;
  type: 'orphan_cleanup' | 'expired_files' | 'failed_uploads';
  scope: {
    buckets?: string[];
    olderThan?: string;
    dryRun?: boolean;
  };
  metadata: {
    scheduledAt: string;
    estimatedItems: number;
  };
}
```

### 4.2 Job Status & State Management

```typescript
enum JobStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  PAUSED = 'paused'
}

interface JobState {
  id: string;
  status: JobStatus;
  progress: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  attempts: number;
  maxAttempts: number;
  error?: string;
  result?: any;
  logs: JobLogEntry[];
}

interface JobLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, any>;
}
```

---

## 5. Queue Management

### 5.1 Queue Types & Configuration

```typescript
interface QueueTypeConfig {
  name: string;
  displayName: string;
  description: string;
  defaultOptions: QueueOptions;
  jobTypes: string[];
  scaling: {
    minWorkers: number;
    maxWorkers: number;
    scalingThreshold: number;
  };
}

const QUEUE_TYPES: Record<string, QueueTypeConfig> = {
  'photo-processing': {
    name: 'photo-processing',
    displayName: 'Photo Processing',
    description: 'Main queue for photo processing operations',
    defaultOptions: {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50
      },
      settings: {
        stalledInterval: 30000,
        retryProcessDelay: 5000,
        maxStalledCount: 1
      }
    },
    jobTypes: ['process-photo', 'generate-thumbnails', 'extract-metadata'],
    scaling: {
      minWorkers: 2,
      maxWorkers: 10,
      scalingThreshold: 50
    }
  },
  
  'batch-processing': {
    name: 'batch-processing',
    displayName: 'Batch Processing',
    description: 'Queue for batch operations on multiple photos',
    defaultOptions: {
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 20,
        removeOnFail: 20
      },
      settings: {
        stalledInterval: 60000,
        retryProcessDelay: 10000,
        maxStalledCount: 1
      }
    },
    jobTypes: ['batch-process', 'batch-cleanup'],
    scaling: {
      minWorkers: 1,
      maxWorkers: 3,
      scalingThreshold: 10
    }
  },
  
  'maintenance': {
    name: 'maintenance',
    displayName: 'System Maintenance',
    description: 'Queue for system maintenance and cleanup tasks',
    defaultOptions: {
      defaultJobOptions: {
        attempts: 1,
        backoff: { type: 'fixed', delay: 60000 },
        removeOnComplete: 10,
        removeOnFail: 10
      },
      settings: {
        stalledInterval: 120000,
        retryProcessDelay: 30000,
        maxStalledCount: 1
      }
    },
    jobTypes: ['cleanup-orphans', 'consistency-check', 'metrics-aggregation'],
    scaling: {
      minWorkers: 1,
      maxWorkers: 2,
      scalingThreshold: 5
    }
  }
};
```

### 5.2 Queue Health Monitoring

```typescript
interface QueueHealthChecker {
  checkQueueHealth(queueName: string): Promise<QueueHealthStatus>;
  getAllQueuesHealth(): Promise<Map<string, QueueHealthStatus>>;
  getHealthRecommendations(queueName: string): Promise<HealthRecommendation[]>;
}

class QueueHealthCheckerImpl implements QueueHealthChecker {
  private queueManager: QueueManager;
  private metrics: MetricsCollector;
  private logger: Logger;
  
  constructor(
    queueManager: QueueManager,
    metrics: MetricsCollector,
    logger: Logger
  ) {
    this.queueManager = queueManager;
    this.metrics = metrics;
    this.logger = logger;
  }
  
  async checkQueueHealth(queueName: string): Promise<QueueHealthStatus> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      return {
        queueName,
        status: 'unknown',
        message: 'Queue not found',
        metrics: null,
        issues: [{ severity: 'critical', message: 'Queue does not exist' }]
      };
    }
    
    const [jobCounts, workers, isPaused] = await Promise.all([
      queue.getJobCounts(),
      queue.getWorkers(),
      queue.isPaused()
    ]);
    
    const queueMetrics: QueueHealthMetrics = {
      jobCounts,
      activeWorkers: workers.length,
      isPaused,
      processingRate: await this.calculateProcessingRate(queueName),
      averageWaitTime: await this.calculateAverageWaitTime(queueName),
      errorRate: await this.calculateErrorRate(queueName)
    };
    
    const issues = this.analyzeHealthIssues(queueMetrics);
    const status = this.determineHealthStatus(issues);
    
    return {
      queueName,
      status,
      message: this.generateHealthMessage(status, issues),
      metrics: queueMetrics,
      issues
    };
  }
  
  private analyzeHealthIssues(metrics: QueueHealthMetrics): HealthIssue[] {
    const issues: HealthIssue[] = [];
    
    // Check for high queue depth
    if (metrics.jobCounts.waiting > 1000) {
      issues.push({
        severity: 'warning',
        message: `High number of waiting jobs: ${metrics.jobCounts.waiting}`
      });
    }
    
    // Check for no active workers
    if (metrics.activeWorkers === 0 && metrics.jobCounts.waiting > 0) {
      issues.push({
        severity: 'critical',
        message: 'No active workers but jobs are waiting'
      });
    }
    
    // Check for high error rate
    if (metrics.errorRate > 0.1) {
      issues.push({
        severity: 'warning',
        message: `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`
      });
    }
    
    // Check if queue is paused
    if (metrics.isPaused) {
      issues.push({
        severity: 'warning',
        message: 'Queue is currently paused'
      });
    }
    
    // Check for slow processing
    if (metrics.averageWaitTime > 300000) { // 5 minutes
      issues.push({
        severity: 'warning',
        message: `High average wait time: ${Math.round(metrics.averageWaitTime / 1000)}s`
      });
    }
    
    return issues;
  }
  
  private determineHealthStatus(issues: HealthIssue[]): HealthStatus {
    if (issues.some(i => i.severity === 'critical')) {
      return 'unhealthy';
    }
    if (issues.some(i => i.severity === 'warning')) {
      return 'degraded';
    }
    return 'healthy';
  }
  
  private async calculateProcessingRate(queueName: string): Promise<number> {
    // Implementation would query metrics store for recent processing rate
    return 0; // Placeholder
  }
  
  private async calculateAverageWaitTime(queueName: string): Promise<number> {
    // Implementation would calculate average time between job creation and processing
    return 0; // Placeholder
  }
  
  private async calculateErrorRate(queueName: string): Promise<number> {
    // Implementation would calculate ratio of failed to total jobs over recent time period
    return 0; // Placeholder
  }
  
  private generateHealthMessage(status: HealthStatus, issues: HealthIssue[]): string {
    switch (status) {
      case 'healthy':
        return 'Queue is operating normally';
      case 'degraded':
        return `Queue has ${issues.length} warning(s) but is still functional`;
      case 'unhealthy':
        return `Queue has critical issues that require immediate attention`;
      default:
        return 'Queue status unknown';
    }
  }
}

interface QueueHealthStatus {
  queueName: string;
  status: HealthStatus;
  message: string;
  metrics: QueueHealthMetrics | null;
  issues: HealthIssue[];
}

interface QueueHealthMetrics {
  jobCounts: {
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  activeWorkers: number;
  isPaused: boolean;
  processingRate: number;
  averageWaitTime: number;
  errorRate: number;
}

interface HealthIssue {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

interface HealthRecommendation {
  type: 'scale_workers' | 'adjust_settings' | 'investigate_errors' | 'resume_queue';
  priority: 'low' | 'medium' | 'high';
  description: string;
  action: string;
}
```

---

## 6. Worker Management

### 6.1 Worker Pool Management

```typescript
interface WorkerPool {
  queueName: string;
  minWorkers: number;
  maxWorkers: number;
  currentWorkers: number;
  targetWorkers: number;
  autoScaling: boolean;
  lastScalingEvent?: Date;
}

interface WorkerPoolManager {
  createWorkerPool(queueName: string, config: WorkerPoolConfig): Promise<WorkerPool>;
  scaleWorkerPool(queueName: string, targetWorkers: number): Promise<ScalingResult>;
  enableAutoScaling(queueName: string, policy: AutoScalingPolicy): Promise<void>;
  disableAutoScaling(queueName: string): Promise<void>;
  getWorkerPool(queueName: string): WorkerPool | null;
  getAllWorkerPools(): Map<string, WorkerPool>;
}

class WorkerPoolManagerImpl implements WorkerPoolManager {
  private workerPools: Map<string, WorkerPool> = new Map();
  private workerManager: WorkerManager;
  private autoScalingPolicies: Map<string, AutoScalingPolicy> = new Map();
  private scalingCooldowns: Map<string, number> = new Map();
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(
    workerManager: WorkerManager,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.workerManager = workerManager;
    this.logger = logger;
    this.metrics = metrics;
    
    // Setup auto-scaling monitoring
    this.setupAutoScalingMonitor();
  }
  
  async enableAutoScaling(
    queueName: string,
    policy: AutoScalingPolicy
  ): Promise<void> {
    const pool = this.workerPools.get(queueName);
    if (!pool) {
      throw new Error(`Worker pool for queue '${queueName}' not found`);
    }
    
    this.autoScalingPolicies.set(queueName, policy);
    pool.autoScaling = true;
    
    this.logger.info(`Auto-scaling enabled`, {
      queueName,
      policy
    });
  }
  
  private setupAutoScalingMonitor(): void {
    setInterval(async () => {
      await this.checkAutoScaling();
    }, 30000); // Check every 30 seconds
  }
  
  private async checkAutoScaling(): Promise<void> {
    for (const [queueName, pool] of this.workerPools.entries()) {
      if (!pool.autoScaling) continue;
      
      const policy = this.autoScalingPolicies.get(queueName);
      if (!policy) continue;
      
      // Check cooldown period
      const lastScaling = this.scalingCooldowns.get(queueName) || 0;
      const cooldownPeriod = policy.scaleUpCooldown || 300000; // 5 minutes default
      if (Date.now() - lastScaling < cooldownPeriod) {
        continue;
      }
      
      const metrics = await this.getQueueMetrics(queueName);
      const recommendedWorkers = this.calculateRecommendedWorkers(metrics, policy);
      
      if (recommendedWorkers !== pool.currentWorkers) {
        const clampedWorkers = Math.max(
          pool.minWorkers,
          Math.min(pool.maxWorkers, recommendedWorkers)
        );
        
        if (clampedWorkers !== pool.currentWorkers) {
          await this.scaleWorkerPool(queueName, clampedWorkers);
          this.scalingCooldowns.set(queueName, Date.now());
        }
      }
    }
  }
  
  private calculateRecommendedWorkers(
    metrics: QueueMetrics,
    policy: AutoScalingPolicy
  ): number {
    // Simple scaling algorithm based on queue depth and processing rate
    const waitingJobs = metrics.waiting;
    const activeWorkers = metrics.activeWorkers;
    const processingRate = metrics.processingRate;
    
    // If no jobs waiting, scale down gradually
    if (waitingJobs === 0) {
      return Math.max(1, Math.floor(activeWorkers * 0.7));
    }
    
    // Calculate desired workers based on queue depth
    const targetProcessingTime = policy.targetProcessingTime || 60000; // 1 minute
    const jobsPerWorkerPerMinute = processingRate / activeWorkers || 1;
    const requiredWorkers = Math.ceil(waitingJobs / (jobsPerWorkerPerMinute * (targetProcessingTime / 60000)));
    
    // Apply scaling factor for safety margin
    return Math.ceil(requiredWorkers * (policy.scalingFactor || 1.2));
  }
  
  private async getQueueMetrics(queueName: string): Promise<QueueMetrics> {
    // Implementation would fetch current queue metrics
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      activeWorkers: 0,
      processingRate: 0,
      averageProcessingTime: 0
    };
  }
}

interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  initialWorkers: number;
  autoScaling?: boolean;
  processor: JobProcessor;
  workerOptions?: WorkerOptions;
}

interface AutoScalingPolicy {
  targetProcessingTime: number;
  scalingFactor: number;
  scaleUpCooldown: number;
  scaleDownCooldown: number;
  maxScaleUpStep: number;
  maxScaleDownStep: number;
}

interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  activeWorkers: number;
  processingRate: number;
  averageProcessingTime: number;
}
```

---

## 7. Error Handling & Resilience

### 7.1 Retry Handler

```typescript
interface RetryHandler {
  calculateRetryDelay(attempt: number, options: BackoffOptions): number;
  shouldRetry(error: Error, attempt: number, maxAttempts: number): boolean;
  handleJobRetry(job: Job, error: Error): Promise<RetryDecision>;
  getRetryStatistics(queueName: string): Promise<RetryStatistics>;
}

class RetryHandlerImpl implements RetryHandler {
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }
  
  calculateRetryDelay(attempt: number, options: BackoffOptions): number {
    let delay: number;
    
    switch (options.type) {
      case 'fixed':
        delay = options.delay;
        break;
      case 'exponential':
        delay = Math.min(
          options.delay * Math.pow(2, attempt - 1),
          options.maxDelay || 300000 // 5 minutes max
        );
        break;
      default:
        delay = options.delay;
    }
    
    // Add jitter to prevent thundering herd
    const jitterPercent = 0.1; // 10% jitter
    const jitter = delay * jitterPercent * Math.random();
    delay += jitter;
    
    return Math.round(delay);
  }
  
  shouldRetry(error: Error, attempt: number, maxAttempts: number): boolean {
    // Don't retry if we've exceeded max attempts
    if (attempt >= maxAttempts) {
      return false;
    }
    
    // Check error type for non-retryable errors
    if (this.isNonRetryableError(error)) {
      return false;
    }
    
    return true;
  }
  
  async handleJobRetry(job: Job, error: Error): Promise<RetryDecision> {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 3;
    
    if (!this.shouldRetry(error, attempt, maxAttempts)) {
      this.metrics.incrementCounter('job_retries_exhausted_total', {
        queue: job.queueName,
        job_type: job.name,
        error_type: error.constructor.name
      });
      
      return {
        action: 'fail',
        reason: attempt >= maxAttempts ? 'max_attempts_exceeded' : 'non_retryable_error',
        delay: 0
      };
    }
    
    const backoffOptions = job.opts.backoff as BackoffOptions || {
      type: 'exponential',
      delay: 2000
    };
    
    const delay = this.calculateRetryDelay(attempt, backoffOptions);
    
    this.logger.warn(`Job will be retried`, {
      jobId: job.id,
      queueName: job.queueName,
      jobType: job.name,
      attempt,
      maxAttempts,
      delay,
      error: error.message
    });
    
    this.metrics.incrementCounter('job_retries_total', {
      queue: job.queueName,
      job_type: job.name,
      attempt: String(attempt)
    });
    
    this.metrics.recordHistogram('job_retry_delay_ms', delay, {
      queue: job.queueName,
      job_type: job.name
    });
    
    return {
      action: 'retry',
      reason: 'retryable_error',
      delay
    };
  }
  
  private isNonRetryableError(error: Error): boolean {
    const nonRetryableErrors = [
      'ValidationError',
      'AuthenticationError',
      'AuthorizationError',
      'NotFoundError',
      'BadRequestError'
    ];
    
    return nonRetryableErrors.includes(error.constructor.name) ||
           error.message.includes('INVALID_DATA') ||
           error.message.includes('PERMISSION_DENIED');
  }
}

interface RetryDecision {
  action: 'retry' | 'fail';
  reason: string;
  delay: number;
}

interface RetryStatistics {
  queueName: string;
  totalRetries: number;
  retriesByAttempt: Record<string, number>;
  retriesByErrorType: Record<string, number>;
  averageRetryDelay: number;
  retrySuccessRate: number;
}
```

### 7.2 Dead Letter Handler

```typescript
interface DeadLetterHandler {
  handleFailedJob(job: Job, error: Error): Promise<void>;
  getFailedJobs(queueName: string, limit?: number): Promise<FailedJob[]>;
  requeueFailedJob(queueName: string, jobId: string): Promise<void>;
  archiveFailedJob(queueName: string, jobId: string): Promise<void>;
  purgeFailedJobs(queueName: string, olderThan?: Date): Promise<number>;
  getFailedJobStatistics(queueName: string): Promise<FailedJobStatistics>;
}

class DeadLetterHandlerImpl implements DeadLetterHandler {
  private queueManager: QueueManager;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(
    queueManager: QueueManager,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.queueManager = queueManager;
    this.logger = logger;
    this.metrics = metrics;
  }
  
  async handleFailedJob(job: Job, error: Error): Promise<void> {
    const failedJob: FailedJob = {
      id: job.id!,
      queueName: job.queueName,
      name: job.name,
      data: job.data,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      attempts: job.attemptsMade,
      failedAt: new Date(),
      originalJobOptions: job.opts
    };
    
    // Store failed job for manual review
    await this.storeFailedJob(failedJob);
    
    // Log the failure
    this.logger.error(`Job permanently failed`, {
      jobId: job.id,
      queueName: job.queueName,
      jobType: job.name,
      error: error.message,
      attempts: job.attemptsMade
    });
    
    // Update metrics
    this.metrics.incrementCounter('jobs_dead_letter_total', {
      queue: job.queueName,
      job_type: job.name,
      error_type: error.constructor.name
    });
    
    // Check if we need to alert on failed job patterns
    await this.checkFailurePatterns(job.queueName, job.name, error);
  }
  
  async requeueFailedJob(queueName: string, jobId: string): Promise<void> {
    const failedJob = await this.getFailedJob(queueName, jobId);
    if (!failedJob) {
      throw new Error(`Failed job ${jobId} not found in queue ${queueName}`);
    }
    
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    
    // Reset attempts and re-add to queue
    const jobOptions = {
      ...failedJob.originalJobOptions,
      attempts: failedJob.originalJobOptions.attempts || 3,
      jobId: `retry_${failedJob.id}_${Date.now()}`
    };
    
    await queue.add(failedJob.name, failedJob.data, jobOptions);
    
    // Remove from failed job store
    await this.removeFailedJob(queueName, jobId);
    
    this.logger.info(`Failed job requeued`, {
      originalJobId: jobId,
      queueName,
      newJobId: jobOptions.jobId
    });
    
    this.metrics.incrementCounter('failed_jobs_requeued_total', {
      queue: queueName,
      job_type: failedJob.name
    });
  }
  
  private async storeFailedJob(failedJob: FailedJob): Promise<void> {
    // Implementation would store failed job in persistent storage
    // For now, we'll store in memory
    this.logger.debug(`Storing failed job`, { jobId: failedJob.id });
  }
  
  private async getFailedJob(queueName: string, jobId: string): Promise<FailedJob | null> {
    // Implementation would retrieve failed job from storage
    return null; // Placeholder
  }
  
  private async removeFailedJob(queueName: string, jobId: string): Promise<void> {
    // Implementation would remove failed job from storage
    this.logger.debug(`Removing failed job`, { jobId, queueName });
  }
  
  private async checkFailurePatterns(
    queueName: string,
    jobType: string,
    error: Error
  ): Promise<void> {
    // Check for patterns that might indicate systemic issues
    const recentFailures = await this.getRecentFailures(queueName, jobType, 300000); // 5 minutes
    
    if (recentFailures.length > 10) {
      this.logger.warn(`High failure rate detected`, {
        queueName,
        jobType,
        failureCount: recentFailures.length,
        errorType: error.constructor.name
      });
      
      // Could trigger alerts or auto-scaling here
    }
  }
  
  private async getRecentFailures(
    queueName: string,
    jobType: string,
    timeWindowMs: number
  ): Promise<FailedJob[]> {
    // Implementation would query recent failures
    return []; // Placeholder
  }
}

interface FailedJob {
  id: string;
  queueName: string;
  name: string;
  data: any;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  attempts: number;
  failedAt: Date;
  originalJobOptions: any;
}

interface FailedJobStatistics {
  queueName: string;
  totalFailedJobs: number;
  failuresByJobType: Record<string, number>;
  failuresByErrorType: Record<string, number>;
  oldestFailure?: Date;
  recentFailureRate: number;
}
```

---

## 8. Monitoring & Observability

### 8.1 Metrics Collection

```typescript
interface JobQueueMetrics {
  collectMetrics(): Promise<JobQueueMetricsSnapshot>;
  getQueueMetrics(queueName: string): Promise<QueueMetricsSnapshot>;
  getWorkerMetrics(workerId?: string): Promise<WorkerMetricsSnapshot>;
  exportPrometheusMetrics(): Promise<string>;
}

class JobQueueMetricsImpl implements JobQueueMetrics {
  private metrics: MetricsCollector;
  private queueManager: QueueManager;
  private workerManager: WorkerManager;
  
  constructor(
    metrics: MetricsCollector,
    queueManager: QueueManager,
    workerManager: WorkerManager
  ) {
    this.metrics = metrics;
    this.queueManager = queueManager;
    this.workerManager = workerManager;
    
    this.setupMetricsCollection();
  }
  
  private setupMetricsCollection(): void {
    // Collect queue metrics every 30 seconds
    setInterval(async () => {
      await this.collectQueueMetrics();
    }, 30000);
    
    // Collect worker metrics every 60 seconds
    setInterval(async () => {
      await this.collectWorkerMetrics();
    }, 60000);
  }
  
  async collectMetrics(): Promise<JobQueueMetricsSnapshot> {
    const queues = this.queueManager.getAllQueues();
    const queueMetrics = new Map<string, QueueMetricsSnapshot>();
    
    for (const [queueName, queue] of queues) {
      const metrics = await this.getQueueMetrics(queueName);
      queueMetrics.set(queueName, metrics);
    }
    
    const workerMetrics = await this.getWorkerMetrics();
    
    return {
      timestamp: new Date(),
      queues: queueMetrics,
      workers: workerMetrics,
      system: await this.getSystemMetrics()
    };
  }
  
  async getQueueMetrics(queueName: string): Promise<QueueMetricsSnapshot> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }
    
    const [jobCounts, isPaused] = await Promise.all([
      queue.getJobCounts(),
      queue.isPaused()
    ]);
    
    return {
      name: queueName,
      isPaused,
      jobCounts,
      processingRate: await this.calculateProcessingRate(queueName),
      throughput: await this.calculateThroughput(queueName),
      averageProcessingTime: await this.calculateAverageProcessingTime(queueName),
      errorRate: await this.calculateErrorRate(queueName)
    };
  }
  
  private async collectQueueMetrics(): Promise<void> {
    const queues = this.queueManager.getAllQueues();
    
    for (const [queueName, queue] of queues) {
      try {
        const jobCounts = await queue.getJobCounts();
        
        // Update gauge metrics
        this.metrics.setGauge('queue_jobs_waiting', jobCounts.waiting, { queue: queueName });
        this.metrics.setGauge('queue_jobs_active', jobCounts.active, { queue: queueName });
        this.metrics.setGauge('queue_jobs_completed', jobCounts.completed, { queue: queueName });
        this.metrics.setGauge('queue_jobs_failed', jobCounts.failed, { queue: queueName });
        this.metrics.setGauge('queue_jobs_delayed', jobCounts.delayed, { queue: queueName });
        
        const isPaused = await queue.isPaused();
        this.metrics.setGauge('queue_paused', isPaused ? 1 : 0, { queue: queueName });
        
      } catch (error) {
        console.error(`Failed to collect metrics for queue ${queueName}:`, error);
      }
    }
  }
  
  private async collectWorkerMetrics(): Promise<void> {
    const workers = this.workerManager.getWorkers();
    const workersByQueue = new Map<string, number>();
    
    for (const worker of workers) {
      const queueName = worker.queueName;
      workersByQueue.set(queueName, (workersByQueue.get(queueName) || 0) + 1);
    }
    
    for (const [queueName, count] of workersByQueue) {
      this.metrics.setGauge('queue_active_workers', count, { queue: queueName });
    }
  }
  
  private async calculateProcessingRate(queueName: string): Promise<number> {
    // Calculate jobs processed per minute over last 5 minutes
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    // Implementation would query metrics store
    return 0; // Placeholder
  }
  
  private async calculateThroughput(queueName: string): Promise<number> {
    // Calculate jobs per second over last minute
    return 0; // Placeholder
  }
  
  private async calculateAverageProcessingTime(queueName: string): Promise<number> {
    // Calculate average processing time over last hour
    return 0; // Placeholder
  }
  
  private async calculateErrorRate(queueName: string): Promise<number> {
    // Calculate error rate over last hour
    return 0; // Placeholder
  }
  
  private async getSystemMetrics(): Promise<SystemMetricsSnapshot> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime()
    };
  }
}

interface JobQueueMetricsSnapshot {
  timestamp: Date;
  queues: Map<string, QueueMetricsSnapshot>;
  workers: WorkerMetricsSnapshot;
  system: SystemMetricsSnapshot;
}

interface QueueMetricsSnapshot {
  name: string;
  isPaused: boolean;
  jobCounts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  processingRate: number;
  throughput: number;
  averageProcessingTime: number;
  errorRate: number;
}

interface WorkerMetricsSnapshot {
  totalWorkers: number;
  activeWorkers: number;
  workersByQueue: Record<string, number>;
  averageJobsPerWorker: number;
}

interface SystemMetricsSnapshot {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  uptime: number;
}
```

---

## 9. Performance & Scaling

### 9.1 Performance Optimization Strategies

```typescript
interface PerformanceOptimizer {
  optimizeQueue(queueName: string): Promise<OptimizationResult>;
  analyzeBottlenecks(queueName: string): Promise<BottleneckAnalysis>;
  recommendScaling(queueName: string): Promise<ScalingRecommendation>;
}

class PerformanceOptimizerImpl implements PerformanceOptimizer {
  private queueManager: QueueManager;
  private workerManager: WorkerManager;
  private metrics: MetricsCollector;
  private logger: Logger;

  async optimizeQueue(queueName: string): Promise<OptimizationResult> {
    const analysis = await this.analyzeBottlenecks(queueName);
    const recommendations: OptimizationAction[] = [];

    // Analyze queue depth
    if (analysis.avgQueueDepth > 100) {
      recommendations.push({
        type: 'scale_workers',
        priority: 'high',
        description: 'Scale up workers to handle queue backlog',
        expectedImpact: 'Reduce processing latency by 40-60%'
      });
    }

    // Analyze processing time
    if (analysis.avgProcessingTime > 30000) {
      recommendations.push({
        type: 'optimize_job_logic',
        priority: 'medium',
        description: 'Review and optimize job processing logic',
        expectedImpact: 'Reduce processing time by 20-30%'
      });
    }

    // Analyze memory usage
    if (analysis.memoryUsage > 0.8) {
      recommendations.push({
        type: 'optimize_memory',
        priority: 'high',
        description: 'Optimize memory usage in job processors',
        expectedImpact: 'Prevent memory-related failures'
      });
    }

    return {
      queueName,
      currentPerformance: this.calculatePerformanceScore(analysis),
      recommendations,
      estimatedImprovement: this.estimateImprovement(recommendations)
    };
  }

  private calculatePerformanceScore(analysis: BottleneckAnalysis): number {
    // Score from 0-100 based on various factors
    const queueScore = Math.max(0, 100 - (analysis.avgQueueDepth / 10));
    const throughputScore = Math.min(100, analysis.throughput / 10);
    const errorScore = Math.max(0, 100 - (analysis.errorRate * 100));
    
    return (queueScore + throughputScore + errorScore) / 3;
  }
}

interface OptimizationResult {
  queueName: string;
  currentPerformance: number;
  recommendations: OptimizationAction[];
  estimatedImprovement: number;
}

interface OptimizationAction {
  type: string;
  priority: 'low' | 'medium' | 'high';
  description: string;
  expectedImpact: string;
}

interface BottleneckAnalysis {
  queueName: string;
  avgQueueDepth: number;
  avgProcessingTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
}
```

### 9.2 Scaling Patterns

```typescript
const SCALING_PATTERNS = {
  photo_processing: {
    pattern: 'predictive',
    factors: ['queue_depth', 'time_of_day', 'historical_load'],
    thresholds: {
      scale_up: { queue_depth: 50, latency: 30000 },
      scale_down: { queue_depth: 10, idle_time: 300000 }
    }
  },
  
  batch_processing: {
    pattern: 'reactive',
    factors: ['queue_depth', 'worker_utilization'],
    thresholds: {
      scale_up: { queue_depth: 20, worker_utilization: 0.8 },
      scale_down: { queue_depth: 5, worker_utilization: 0.3 }
    }
  },
  
  maintenance: {
    pattern: 'scheduled',
    factors: ['time_of_day', 'system_load'],
    schedule: {
      peak_hours: { min_workers: 1, max_workers: 1 },
      off_hours: { min_workers: 2, max_workers: 3 }
    }
  }
};
```

---

## 10. Security

### 10.1 Job Security Framework

```typescript
interface JobSecurityManager {
  validateJobData(queueName: string, jobName: string, data: any): Promise<void>;
  sanitizeJobInput(data: any): any;
  validateJobExecution(job: Job, context: JobProcessingContext): Promise<void>;
  auditJobActivity(job: Job, action: string, metadata?: any): Promise<void>;
}

class JobSecurityManagerImpl implements JobSecurityManager {
  private config: SecurityConfig;
  private logger: Logger;
  private auditLogger: AuditLogger;

  async validateJobData(queueName: string, jobName: string, data: any): Promise<void> {
    // Input validation
    if (!data || typeof data !== 'object') {
      throw new SecurityError('Invalid job data format');
    }

    // Size limits
    const serialized = JSON.stringify(data);
    if (serialized.length > this.config.maxJobDataSize) {
      throw new SecurityError(`Job data exceeds size limit: ${serialized.length} bytes`);
    }

    // Content sanitization
    if (this.containsMaliciousContent(serialized)) {
      throw new SecurityError('Malicious content detected in job data');
    }

    // Queue-specific validation
    await this.validateQueueSpecificData(queueName, jobName, data);
  }

  async validateJobExecution(job: Job, context: JobProcessingContext): Promise<void> {
    // Check job age
    const jobAge = Date.now() - job.timestamp;
    if (jobAge > this.config.maxJobAge) {
      throw new SecurityError('Job is too old to process');
    }

    // Validate worker permissions
    if (!this.hasWorkerPermission(context.workerId, job.queueName)) {
      throw new SecurityError('Worker lacks permission to process this queue');
    }

    // Rate limiting per client
    if (job.data._metadata?.clientId) {
      await this.checkClientRateLimit(job.data._metadata.clientId);
    }
  }

  private containsMaliciousContent(content: string): boolean {
    const maliciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /__proto__|constructor\.prototype/gi
    ];

    return maliciousPatterns.some(pattern => pattern.test(content));
  }
}

interface SecurityConfig {
  maxJobDataSize: number;
  maxJobAge: number;
  enableAuditLogging: boolean;
  rateLimiting: {
    enabled: boolean;
    maxJobsPerMinute: number;
    windowMs: number;
  };
}
```

### 10.2 Access Control

```typescript
interface JobAccessControl {
  canEnqueueJob(clientId: string, queueName: string, jobType: string): Promise<boolean>;
  canViewQueue(clientId: string, queueName: string): Promise<boolean>;
  canManageQueue(clientId: string, queueName: string): Promise<boolean>;
  getClientPermissions(clientId: string): Promise<Permission[]>;
}

interface Permission {
  resource: string;
  actions: string[];
  conditions?: PermissionCondition[];
}

interface PermissionCondition {
  field: string;
  operator: 'equals' | 'in' | 'not_in';
  value: any;
}
```

---

## 11. Configuration

### 11.1 Configuration Schema

```typescript
interface JobQueueCoordinatorConfig {
  // Redis Configuration
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
    maxRetriesPerRequest: number;
    retryDelayOnFailover: number;
  };

  // Queue Defaults
  defaultJobOptions: {
    attempts: number;
    backoff: {
      type: 'fixed' | 'exponential';
      delay: number;
      maxDelay?: number;
    };
    removeOnComplete: number | boolean;
    removeOnFail: number | boolean;
    priority: number;
  };

  // Worker Defaults
  defaultWorkerOptions: {
    concurrency: number;
    limiter?: {
      max: number;
      duration: number;
    };
    settings: {
      stalledInterval: number;
      retryProcessDelay: number;
      maxStalledCount: number;
    };
  };

  // Security
  security: {
    maxJobDataSize: number;
    maxJobAge: number;
    enableJobValidation: boolean;
    rateLimiting: {
      enabled: boolean;
      maxJobsPerMinute: number;
    };
  };

  // Monitoring
  monitoring: {
    metricsCollection: {
      enabled: boolean;
      interval: number;
    };
    healthChecks: {
      enabled: boolean;
      interval: number;
    };
  };

  // Performance
  performance: {
    autoScaling: {
      enabled: boolean;
      checkInterval: number;
      cooldownPeriod: number;
    };
    optimization: {
      enabled: boolean;
      analysisInterval: number;
    };
  };
}
```

### 11.2 Environment Configuration

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=photo-queue:

# Job Configuration
DEFAULT_JOB_ATTEMPTS=3
DEFAULT_JOB_BACKOFF_DELAY=2000
DEFAULT_JOB_PRIORITY=0

# Worker Configuration
DEFAULT_WORKER_CONCURRENCY=1
WORKER_STALLED_INTERVAL=30000
WORKER_RETRY_PROCESS_DELAY=5000

# Security
MAX_JOB_DATA_SIZE=1048576
MAX_JOB_AGE=3600000
ENABLE_RATE_LIMITING=true
MAX_JOBS_PER_MINUTE=1000

# Monitoring
ENABLE_METRICS_COLLECTION=true
METRICS_COLLECTION_INTERVAL=30000
ENABLE_HEALTH_CHECKS=true
HEALTH_CHECK_INTERVAL=60000

# Performance
ENABLE_AUTO_SCALING=true
AUTO_SCALING_CHECK_INTERVAL=30000
SCALING_COOLDOWN_PERIOD=300000
```

---

## 12. Implementation Guidelines

### 12.1 Development Setup

```bash
#!/bin/bash
# Setup script for job queue coordinator development

echo "Setting up Job Queue Coordinator development environment..."

# Install dependencies
npm install bullmq redis ioredis

# Start Redis for development
docker run -d \
  --name redis-jobqueue-dev \
  -p 6379:6379 \
  redis:7-alpine \
  redis-server --appendonly yes

# Create configuration file
mkdir -p config
cat > config/job-queue-dev.json << EOF
{
  "redis": {
    "host": "localhost",
    "port": 6379,
    "db": 0,
    "keyPrefix": "photo-queue:dev:"
  },
  "defaultJobOptions": {
    "attempts": 3,
    "backoff": { "type": "exponential", "delay": 2000 },
    "removeOnComplete": 50,
    "removeOnFail": 25
  },
  "monitoring": {
    "metricsCollection": { "enabled": true, "interval": 10000 },
    "healthChecks": { "enabled": true, "interval": 30000 }
  }
}
EOF

echo "Development environment ready!"
echo "Redis: localhost:6379"
echo "Config: config/job-queue-dev.json"
```

### 12.2 Testing Strategy

```typescript
// Test utilities for job queue coordinator
export class JobQueueTestUtils {
  static async createTestQueue(name: string): Promise<Queue> {
    const queue = new Queue(name, {
      connection: {
        host: 'localhost',
        port: 6379,
        db: 15 // Use separate DB for tests
      }
    });
    
    await queue.obliterate(); // Clean existing jobs
    return queue;
  }

  static async waitForJob(
    queue: Queue, 
    jobId: string, 
    timeout: number = 5000
  ): Promise<Job> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const job = await queue.getJob(jobId);
      if (job && (job.isCompleted || job.isFailed)) {
        return job;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
  }

  static createMockProcessor(
    processingTime: number = 100,
    shouldFail: boolean = false
  ): JobProcessor {
    return async (job: Job) => {
      await new Promise(resolve => setTimeout(resolve, processingTime));
      
      if (shouldFail) {
        throw new Error('Mock processor failure');
      }
      
      return { success: true, processedAt: Date.now() };
    };
  }
}

// Example test
describe('JobQueueCoordinator', () => {
  let coordinator: JobQueueCoordinator;
  let testQueue: Queue;

  beforeEach(async () => {
    coordinator = new JobQueueCoordinatorImpl(testConfig);
    testQueue = await JobQueueTestUtils.createTestQueue('test-queue');
  });

  test('should process jobs successfully', async () => {
    const processor = JobQueueTestUtils.createMockProcessor(50);
    const worker = await coordinator.registerWorker('test-queue', processor);

    const job = await coordinator.enqueueJob('test-queue', 'test-job', {
      message: 'Hello, World!'
    });

    const completedJob = await JobQueueTestUtils.waitForJob(testQueue, job.id!);
    
    expect(completedJob.isCompleted).toBe(true);
    expect(completedJob.returnvalue.success).toBe(true);
  });
});
```

### 12.3 Production Deployment

```yaml
# kubernetes/job-queue-coordinator.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-queue-coordinator
spec:
  replicas: 2
  selector:
    matchLabels:
      app: job-queue-coordinator
  template:
    metadata:
      labels:
        app: job-queue-coordinator
    spec:
      containers:
      - name: job-queue-coordinator
        image: photo-management/job-queue-coordinator:latest
        ports:
        - containerPort: 3000
        env:
        - name: REDIS_HOST
          value: "redis-service"
        - name: REDIS_PORT
          value: "6379"
        - name: ENABLE_AUTO_SCALING
          value: "true"
        - name: MAX_JOBS_PER_MINUTE
          value: "5000"
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: job-queue-coordinator-service
spec:
  selector:
    app: job-queue-coordinator
  ports:
  - port: 3000
    targetPort: 3000
```

### 12.4 Operational Procedures

```bash
#!/bin/bash
# Operational scripts for job queue management

# Monitor queue health
function check_queue_health() {
  local queue_name=$1
  curl -s http://job-queue-coordinator:3000/queues/${queue_name}/health | jq '.'
}

# Scale workers for a queue
function scale_queue_workers() {
  local queue_name=$1
  local target_workers=$2
  
  curl -X POST \
    -H "Content-Type: application/json" \
    -d "{\"targetWorkers\": ${target_workers}}" \
    http://job-queue-coordinator:3000/queues/${queue_name}/scale
}

# Get failed jobs
function get_failed_jobs() {
  local queue_name=$1
  curl -s http://job-queue-coordinator:3000/queues/${queue_name}/failed | jq '.'
}

# Requeue failed job
function requeue_failed_job() {
  local queue_name=$1
  local job_id=$2
  
  curl -X POST \
    http://job-queue-coordinator:3000/queues/${queue_name}/failed/${job_id}/requeue
}

# Export queue metrics for monitoring
function export_queue_metrics() {
  curl -s http://job-queue-coordinator:3000/metrics
}
```

---

## Conclusion

The Job Queue Coordinator provides a **robust, scalable, and secure** foundation for managing asynchronous job processing in the photo management system. Key benefits include:

### Architecture Benefits
- **Centralized Coordination**: Single point of control for all job queues
- **Horizontal Scaling**: Auto-scaling workers based on queue depth and performance
- **Fault Tolerance**: Built-in retry mechanisms and dead letter handling
- **Performance Optimization**: Intelligent job scheduling and resource management

### Operational Benefits
- **Monitoring & Observability**: Comprehensive metrics and health checks
- **Security**: Input validation, rate limiting, and access control
- **Maintenance**: Automated cleanup and consistency checks
- **Flexibility**: Configurable job types and processing pipelines

### Developer Benefits
- **Simple Interface**: Easy-to-use APIs for job enqueuing and processing
- **Testing Support**: Comprehensive testing utilities and mocks
- **Documentation**: Clear examples and operational procedures
- **Extensibility**: Plugin architecture for custom job types and processors

This design ensures reliable and efficient processing of photo management workloads while maintaining operational simplicity and developer productivity.