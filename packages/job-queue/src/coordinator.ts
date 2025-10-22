/**
 * Job Queue Coordinator - Main entry point for job queue operations
 * @module @shared-infra/job-queue/coordinator
 */

import { Queue, Job } from 'bullmq';
import {
  JobQueueCoordinatorConfig,
  QueueConfig,
  QueueStatus,
  WorkerConfig,
  ScheduleOptions,
  RecurringJobOptions,
  JobProcessor,
  WorkerStatus,
  ScalingResult,
  FailedJob,
} from './types';
import { QueueManager, QueueManagerConfig } from './core/queue-manager';
import { JobScheduler } from './core/job-scheduler';
import { WorkerManager } from './core/worker-manager';
import { Logger, createLogger } from './utils/logger';

export interface EnqueueJobOptions {
  priority?: number;
  delay?: number;
  maxRetries?: number;
  timeout?: number;
  jobId?: string;
}

export class JobQueueCoordinator {
  private queueManager: QueueManager;
  private jobScheduler: JobScheduler;
  private workerManager: WorkerManager;
  private logger: Logger;
  private config: JobQueueCoordinatorConfig;
  private initialized: boolean = false;

  constructor(config: JobQueueCoordinatorConfig) {
    this.config = config;
    this.logger = createLogger(config.logging, { component: 'JobQueueCoordinator' });

    // Initialize core components
    const queueManagerConfig: QueueManagerConfig = {
      redis: config.redis,
      defaultCleanupPolicy: {
        completedJobsMaxAge: 24 * 60 * 60 * 1000, // 24 hours
        failedJobsMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        completedJobsMaxCount: 1000,
        failedJobsMaxCount: 5000,
      },
      enableMetrics: config.metrics?.enabled !== false,
    };

    this.queueManager = new QueueManager(queueManagerConfig);
    this.jobScheduler = new JobScheduler(this.queueManager);
    this.workerManager = new WorkerManager(this.queueManager);

    this.logger.info('JobQueueCoordinator initialized', {
      redis: `${config.redis.host}:${config.redis.port}`,
      queues: config.queues?.length || 0,
      workers: config.workers?.length || 0,
    });
  }

  /**
   * Initialize the coordinator and create configured queues/workers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('JobQueueCoordinator already initialized');
      return;
    }

    this.logger.info('Initializing JobQueueCoordinator');

    try {
      // Create pre-configured queues
      if (this.config.queues) {
        for (const queueConfig of this.config.queues) {
          await this.createQueue(queueConfig);
        }
      }

      // Register pre-configured workers
      if (this.config.workers) {
        for (const workerConfig of this.config.workers) {
          await this.registerWorker(
            workerConfig.queueName,
            workerConfig.processor,
            workerConfig.options
          );
        }
      }

      this.initialized = true;
      this.logger.info('JobQueueCoordinator initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize JobQueueCoordinator', error as Error);
      throw error;
    }
  }

  /**
   * Create a new queue
   */
  async createQueue(config: QueueConfig): Promise<Queue> {
    this.logger.info(`Creating queue: ${config.name}`);
    return await this.queueManager.createQueue(config);
  }

  // ============================================================================
  // PRODUCER API - For API services to enqueue jobs
  // ============================================================================

  /**
   * Enqueue a job for processing
   * Main method used by API services to add work to queues
   */
  async enqueueJob<T = any>(
    queueName: string,
    data: T,
    options?: EnqueueJobOptions
  ): Promise<Job<T>> {
    this.logger.info(`Enqueuing job in queue ${queueName}`, {
      queueName,
      options,
    });

    const scheduleOptions: ScheduleOptions = {
      priority: options?.priority,
      delayMs: options?.delay,
      maxRetries: options?.maxRetries,
      timeout: options?.timeout,
      jobId: options?.jobId,
    };

    return await this.jobScheduler.scheduleJob(queueName, 'process-job', data, scheduleOptions);
  }

  /**
   * Enqueue a named job with specific job type
   */
  async enqueueNamedJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options?: EnqueueJobOptions
  ): Promise<Job<T>> {
    this.logger.info(`Enqueuing named job ${jobName} in queue ${queueName}`, {
      queueName,
      jobName,
      options,
    });

    const scheduleOptions: ScheduleOptions = {
      priority: options?.priority,
      delayMs: options?.delay,
      maxRetries: options?.maxRetries,
      timeout: options?.timeout,
      jobId: options?.jobId,
    };

    return await this.jobScheduler.scheduleJob(queueName, jobName, data, scheduleOptions);
  }

  /**
   * Schedule a recurring job with cron expression
   */
  async scheduleRecurringJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options: RecurringJobOptions
  ): Promise<Job<T>> {
    this.logger.info(`Scheduling recurring job ${jobName} in queue ${queueName}`, {
      queueName,
      jobName,
      cronExpression: options.cronExpression,
    });

    return await this.jobScheduler.scheduleRecurringJob(queueName, jobName, data, options);
  }

  /**
   * Bulk enqueue multiple jobs
   */
  async bulkEnqueueJobs<T = any>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options?: EnqueueJobOptions }>
  ): Promise<Job<T>[]> {
    this.logger.info(`Bulk enqueuing ${jobs.length} jobs in queue ${queueName}`, {
      queueName,
      jobCount: jobs.length,
    });

    const schedulerJobs = jobs.map(job => ({
      name: job.name,
      data: job.data,
      options: {
        priority: job.options?.priority,
        delayMs: job.options?.delay,
        maxRetries: job.options?.maxRetries,
        timeout: job.options?.timeout,
        jobId: job.options?.jobId,
      },
    }));

    return await this.jobScheduler.bulkScheduleJobs(queueName, schedulerJobs);
  }

  // ============================================================================
  // CONSUMER API - For worker services to process jobs
  // ============================================================================

  /**
   * Register a worker to process jobs from a queue
   * Main method used by worker services to consume work
   */
  async registerWorker<T = any, R = any>(
    queueName: string,
    processor: JobProcessor<T, R>,
    options?: {
      concurrency?: number;
      limiter?: { max: number; duration: number };
      autorun?: boolean;
    }
  ): Promise<void> {
    this.logger.info(`Registering worker for queue ${queueName}`, {
      queueName,
      concurrency: options?.concurrency || 1,
    });

    const workerConfig: WorkerConfig = {
      queueName,
      processor: processor as JobProcessor,
      concurrency: options?.concurrency,
      options: {
        concurrency: options?.concurrency,
        limiter: options?.limiter,
        autorun: options?.autorun,
      },
    };

    await this.workerManager.registerWorker(workerConfig);

    this.logger.info(`Worker registered successfully for queue ${queueName}`);
  }

  /**
   * Scale workers for a queue
   */
  async scaleWorkers(queueName: string, targetCount: number): Promise<ScalingResult> {
    this.logger.info(`Scaling workers for queue ${queueName}`, {
      queueName,
      targetCount,
    });

    return await this.workerManager.scaleWorkers(queueName, targetCount);
  }

  /**
   * Get worker status for a queue
   */
  getWorkerStatus(queueName: string): WorkerStatus[] {
    return this.workerManager.getQueueWorkerStatus(queueName);
  }

  /**
   * Pause all workers for a queue
   */
  async pauseWorkers(queueName: string): Promise<void> {
    this.logger.info(`Pausing workers for queue ${queueName}`);

    const workers = this.workerManager.getWorkersByQueue(queueName);
    const pausePromises = workers.map(w => this.workerManager.pauseWorker(w.id));

    await Promise.all(pausePromises);

    this.logger.info(`All workers paused for queue ${queueName}`);
  }

  /**
   * Resume all workers for a queue
   */
  async resumeWorkers(queueName: string): Promise<void> {
    this.logger.info(`Resuming workers for queue ${queueName}`);

    const workers = this.workerManager.getWorkersByQueue(queueName);
    const resumePromises = workers.map(w => this.workerManager.resumeWorker(w.id));

    await Promise.all(resumePromises);

    this.logger.info(`All workers resumed for queue ${queueName}`);
  }

  // ============================================================================
  // MONITORING & ADMIN API - For monitoring and management
  // ============================================================================

  /**
   * Get status of a queue
   */
  async getQueueStatus(queueName: string): Promise<QueueStatus | null> {
    return await this.queueManager.getQueueStatus(queueName);
  }

  /**
   * Get status of all queues
   */
  async getAllQueueStatus(): Promise<QueueStatus[]> {
    const queueNames = this.queueManager.getQueueNames();
    const statusPromises = queueNames.map(name => this.queueManager.getQueueStatus(name));

    const statuses = await Promise.all(statusPromises);
    return statuses.filter((s): s is QueueStatus => s !== null);
  }

  /**
   * Get failed jobs from a queue
   */
  async getFailedJobs(queueName: string, start = 0, end = 100): Promise<FailedJob[]> {
    this.logger.debug(`Getting failed jobs for queue ${queueName}`, {
      start,
      end,
    });

    const jobs = await this.jobScheduler.getJobsByState(queueName, 'failed', start, end);

    return jobs.map(job => ({
      id: job.id!,
      queueName,
      name: job.name,
      data: job.data,
      error: job.failedReason || 'Unknown error',
      stackTrace: job.stacktrace,
      attemptsMade: job.attemptsMade,
      failedAt: job.finishedOn || Date.now(),
      originalJobId: job.id!,
      canRetry: job.attemptsMade < (job.opts.attempts || 3),
    }));
  }

  /**
   * Retry a failed job
   */
  async retryJob(queueName: string, jobId: string): Promise<boolean> {
    this.logger.info(`Retrying job ${jobId} in queue ${queueName}`, {
      queueName,
      jobId,
    });

    return await this.jobScheduler.retryJob(queueName, jobId);
  }

  /**
   * Cancel a job
   */
  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    this.logger.info(`Cancelling job ${jobId} in queue ${queueName}`, {
      queueName,
      jobId,
    });

    return await this.jobScheduler.cancelJob(queueName, jobId);
  }

  /**
   * Get a specific job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<Job | null> {
    return await this.jobScheduler.getJob(queueName, jobId);
  }

  /**
   * Get jobs by state
   */
  async getJobsByState(
    queueName: string,
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    start = 0,
    end = 100
  ): Promise<Job[]> {
    return await this.jobScheduler.getJobsByState(queueName, state, start, end);
  }

  /**
   * Pause a queue (stops processing new jobs)
   */
  async pauseQueue(queueName: string): Promise<void> {
    this.logger.info(`Pausing queue ${queueName}`);
    await this.queueManager.pauseQueue(queueName);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    this.logger.info(`Resuming queue ${queueName}`);
    await this.queueManager.resumeQueue(queueName);
  }

  /**
   * Get all repeatable/recurring jobs
   */
  async getRecurringJobs(queueName: string) {
    return await this.jobScheduler.getRepeatableJobs(queueName);
  }

  /**
   * Remove a recurring job
   */
  async removeRecurringJob(
    queueName: string,
    jobName: string,
    repeatOptions: { cron?: string; every?: number }
  ): Promise<boolean> {
    this.logger.info(`Removing recurring job ${jobName} from queue ${queueName}`, {
      queueName,
      jobName,
      repeatOptions,
    });

    return await this.jobScheduler.removeRepeatableJob(queueName, jobName, repeatOptions);
  }

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queues: QueueStatus[];
    workers: {
      total: number;
      active: number;
      paused: number;
    };
    timestamp: number;
  }> {
    const queueStatuses = await this.getAllQueueStatus();
    const allWorkerStatus = this.workerManager.getAllWorkerStatus();

    // Determine overall health
    const hasUnhealthyQueue = queueStatuses.some(q => q.health.status === 'unhealthy');
    const hasDegradedQueue = queueStatuses.some(q => q.health.status === 'degraded');

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (hasUnhealthyQueue) {
      overallStatus = 'unhealthy';
    } else if (hasDegradedQueue) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      queues: queueStatuses,
      workers: {
        total: allWorkerStatus.length,
        active: allWorkerStatus.filter(w => w.isRunning && !w.isPaused).length,
        paused: allWorkerStatus.filter(w => w.isPaused).length,
      },
      timestamp: Date.now(),
    };
  }

  // ============================================================================
  // LIFECYCLE MANAGEMENT
  // ============================================================================

  /**
   * Gracefully shutdown the coordinator
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down JobQueueCoordinator');

    try {
      // Close all workers first (stop processing)
      await this.workerManager.closeAll();

      // Close all queues
      await this.queueManager.closeAll();

      this.initialized = false;

      this.logger.info('JobQueueCoordinator shut down successfully');
    } catch (error) {
      this.logger.error('Error during shutdown', error as Error);
      throw error;
    }
  }

  /**
   * Get the underlying queue manager (for advanced use cases)
   */
  getQueueManager(): QueueManager {
    return this.queueManager;
  }

  /**
   * Get the underlying job scheduler (for advanced use cases)
   */
  getJobScheduler(): JobScheduler {
    return this.jobScheduler;
  }

  /**
   * Get the underlying worker manager (for advanced use cases)
   */
  getWorkerManager(): WorkerManager {
    return this.workerManager;
  }

  /**
   * Check if coordinator is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a new JobQueueCoordinator instance
 */
export function createJobQueueCoordinator(config: JobQueueCoordinatorConfig): JobQueueCoordinator {
  return new JobQueueCoordinator(config);
}
