/**
 * Worker Manager - Manages BullMQ Worker instances
 * @module @shared-infra/job-queue/core/worker-manager
 */

import { Worker, Job } from 'bullmq';
import {
  WorkerConfig,
  WorkerStatus,
  ManagedWorker,
  ScalingResult,
  JobProcessor,
  JobProcessingContext,
} from '../types';
import { QueueManager } from './queue-manager';
import { Logger, createLogger } from '../utils/logger';

export class WorkerManager {
  private workers: Map<string, ManagedWorker>;
  private workersByQueue: Map<string, Set<string>>;
  private queueManager: QueueManager;
  private logger: Logger;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(queueManager: QueueManager) {
    this.workers = new Map();
    this.workersByQueue = new Map();
    this.queueManager = queueManager;
    this.logger = createLogger(undefined, { component: 'WorkerManager' });

    // Setup periodic health checks
    this.setupHealthChecks();
  }

  /**
   * Register a worker for a queue
   */
  async registerWorker(config: WorkerConfig): Promise<ManagedWorker> {
    const { queueName, processor, concurrency, options } = config;

    const workerId = this.generateWorkerId(queueName);

    this.logger.info(`Registering worker for queue ${queueName}`, {
      workerId,
      queueName,
      concurrency: concurrency || options?.concurrency || 1,
    });

    try {
      // Get Redis connection from queue manager
      const redis = this.queueManager.getRedisConnection();

      // Create processing context
      const enhancedProcessor = async (job: Job) => {
        const context: JobProcessingContext = {
          jobId: job.id!,
          queueName,
          attemptsMade: job.attemptsMade,
          timestamp: Date.now(),
          workerId,
        };

        this.logger.debug(`Processing job ${job.id} in queue ${queueName}`, {
          jobName: job.name,
          workerId,
        });

        try {
          const result = await processor(job as any, context);
          await this.recordJobSuccess(queueName, workerId, job as any);
          return result;
        } catch (error) {
          await this.recordJobFailure(queueName, workerId, job as any, error as Error);
          throw error;
        }
      };

      // Create BullMQ Worker
      const worker = new Worker(queueName, enhancedProcessor, {
        connection: redis.duplicate(),
        concurrency: concurrency || options?.concurrency || 1,
        limiter: options?.limiter,
        autorun: options?.autorun !== false,
        lockDuration: options?.lockDuration || 30000,
        lockRenewTime: options?.lockRenewTime || 15000,
        stalledInterval: options?.stalledInterval || 30000,
        maxStalledCount: options?.maxStalledCount || 1,
      });

      // Create managed worker entry
      const managedWorker: ManagedWorker = {
        id: workerId,
        queueName,
        worker,
        processor,
        options: options || {},
        startedAt: Date.now(),
        status: {
          id: workerId,
          queueName,
          isRunning: true,
          isPaused: false,
          activeJobs: 0,
          processedJobs: 0,
          failedJobs: 0,
        },
      };

      this.workers.set(workerId, managedWorker);

      // Track workers by queue
      if (!this.workersByQueue.has(queueName)) {
        this.workersByQueue.set(queueName, new Set());
      }
      this.workersByQueue.get(queueName)!.add(workerId);

      // Setup event handlers
      this.setupWorkerEventHandlers(workerId, worker);

      this.logger.info(`Worker ${workerId} registered successfully for queue ${queueName}`);

      return managedWorker;
    } catch (error) {
      this.logger.error(`Failed to register worker for queue ${queueName}`, error as Error);
      throw error;
    }
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId: string): ManagedWorker | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all workers for a queue
   */
  getWorkersByQueue(queueName: string): ManagedWorker[] {
    const workerIds = this.workersByQueue.get(queueName);
    if (!workerIds) {
      return [];
    }

    return Array.from(workerIds)
      .map(id => this.workers.get(id))
      .filter((w): w is ManagedWorker => w !== undefined);
  }

  /**
   * Get status of all workers
   */
  getAllWorkerStatus(): WorkerStatus[] {
    return Array.from(this.workers.values()).map(w => w.status);
  }

  /**
   * Get status of workers for a specific queue
   */
  getQueueWorkerStatus(queueName: string): WorkerStatus[] {
    return this.getWorkersByQueue(queueName).map(w => w.status);
  }

  /**
   * Pause a worker
   */
  async pauseWorker(workerId: string): Promise<void> {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    await (managedWorker.worker as Worker).pause();
    managedWorker.status.isPaused = true;

    this.logger.info(`Worker ${workerId} paused`);
  }

  /**
   * Resume a worker
   */
  async resumeWorker(workerId: string): Promise<void> {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    await (managedWorker.worker as Worker).resume();
    managedWorker.status.isPaused = false;

    this.logger.info(`Worker ${workerId} resumed`);
  }

  /**
   * Close a worker
   */
  async closeWorker(workerId: string): Promise<void> {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) {
      this.logger.warn(`Worker ${workerId} not found, skipping close`);
      return;
    }

    const { queueName, worker } = managedWorker;

    this.logger.info(`Closing worker ${workerId} for queue ${queueName}`);

    try {
      await (worker as Worker).close();

      // Remove from tracking
      this.workers.delete(workerId);
      const queueWorkers = this.workersByQueue.get(queueName);
      if (queueWorkers) {
        queueWorkers.delete(workerId);
      }

      managedWorker.status.isRunning = false;

      this.logger.info(`Worker ${workerId} closed successfully`);
    } catch (error) {
      this.logger.error(`Failed to close worker ${workerId}`, error as Error);
      throw error;
    }
  }

  /**
   * Close all workers for a queue
   */
  async closeQueueWorkers(queueName: string): Promise<void> {
    const workers = this.getWorkersByQueue(queueName);

    this.logger.info(`Closing ${workers.length} workers for queue ${queueName}`);

    const closePromises = workers.map(w => this.closeWorker(w.id));
    await Promise.all(closePromises);

    this.logger.info(`All workers for queue ${queueName} closed`);
  }

  /**
   * Close all workers
   */
  async closeAll(): Promise<void> {
    this.logger.info('Closing all workers');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    const closePromises = Array.from(this.workers.keys()).map(id => this.closeWorker(id));

    await Promise.all(closePromises);

    this.logger.info('All workers closed');
  }

  /**
   * Scale workers for a queue
   */
  async scaleWorkers(queueName: string, targetCount: number): Promise<ScalingResult> {
    const currentWorkers = this.getWorkersByQueue(queueName);
    const currentCount = currentWorkers.length;

    this.logger.info(`Scaling workers for queue ${queueName}`, {
      currentCount,
      targetCount,
    });

    try {
      if (targetCount < 0) {
        throw new Error('Target worker count must be non-negative');
      }

      if (targetCount === currentCount) {
        return {
          success: true,
          previousCount: currentCount,
          newCount: currentCount,
          message: 'No scaling required',
        };
      }

      if (targetCount > currentCount) {
        // Scale up - add workers
        const workersToAdd = targetCount - currentCount;
        const queue = this.queueManager.getQueue(queueName);

        if (!queue) {
          throw new Error(`Queue ${queueName} not found`);
        }

        // Get default processor or create a simple one
        const baseWorker = currentWorkers[0];
        const processor = baseWorker?.processor || this.getDefaultProcessor();

        const addPromises = Array.from({ length: workersToAdd }, () =>
          this.registerWorker({
            queueName,
            processor,
            concurrency: baseWorker?.options.concurrency || 1,
            options: baseWorker?.options || {},
          })
        );

        await Promise.all(addPromises);

        this.logger.info(`Scaled up workers for queue ${queueName}`, {
          added: workersToAdd,
          newTotal: targetCount,
        });

        return {
          success: true,
          previousCount: currentCount,
          newCount: targetCount,
          message: `Scaled up by ${workersToAdd} workers`,
        };
      } else {
        // Scale down - remove workers
        const workersToRemove = currentCount - targetCount;
        const workersToClose = currentWorkers.slice(0, workersToRemove);

        const closePromises = workersToClose.map(w => this.closeWorker(w.id));
        await Promise.all(closePromises);

        this.logger.info(`Scaled down workers for queue ${queueName}`, {
          removed: workersToRemove,
          newTotal: targetCount,
        });

        return {
          success: true,
          previousCount: currentCount,
          newCount: targetCount,
          message: `Scaled down by ${workersToRemove} workers`,
        };
      }
    } catch (error) {
      this.logger.error(`Failed to scale workers for queue ${queueName}`, error as Error);

      return {
        success: false,
        previousCount: currentCount,
        newCount: currentCount,
        message: `Scaling failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Setup event handlers for a worker
   */
  private setupWorkerEventHandlers(workerId: string, worker: Worker): void {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) {
      return;
    }

    const { queueName, status } = managedWorker;

    worker.on('active', (job: Job) => {
      status.activeJobs++;
      status.lastActive = Date.now();

      this.logger.debug(`Worker ${workerId} processing job ${job.id}`, {
        queueName,
        jobName: job.name,
      });
    });

    worker.on('completed', (job: Job) => {
      status.activeJobs = Math.max(0, status.activeJobs - 1);
      status.processedJobs++;

      this.logger.debug(`Worker ${workerId} completed job ${job.id}`, {
        queueName,
        jobName: job.name,
      });
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      if (status.activeJobs > 0) {
        status.activeJobs--;
      }
      status.failedJobs++;

      this.logger.warn(`Worker ${workerId} failed job ${job?.id}`, {
        queueName,
        jobName: job?.name,
        error: error.message,
      });
    });

    worker.on('error', (error: Error) => {
      this.logger.error(`Worker ${workerId} error`, error, { queueName });
    });

    worker.on('stalled', (jobId: string) => {
      this.logger.warn(`Worker ${workerId} stalled on job ${jobId}`, {
        queueName,
      });
    });

    worker.on('paused', () => {
      status.isPaused = true;
      this.logger.info(`Worker ${workerId} paused`, { queueName });
    });

    worker.on('resumed', () => {
      status.isPaused = false;
      this.logger.info(`Worker ${workerId} resumed`, { queueName });
    });

    worker.on('closed', () => {
      status.isRunning = false;
      this.logger.info(`Worker ${workerId} closed`, { queueName });
    });
  }

  /**
   * Record successful job processing
   */
  private async recordJobSuccess(queueName: string, workerId: string, job: Job): Promise<void> {
    const processingTime = Date.now() - (job.processedOn || Date.now());

    this.logger.debug(`Job ${job.id} succeeded`, {
      queueName,
      workerId,
      jobName: job.name,
      processingTime,
      attemptsMade: job.attemptsMade,
    });
  }

  /**
   * Record failed job processing
   */
  private async recordJobFailure(
    queueName: string,
    workerId: string,
    job: Job,
    error: Error
  ): Promise<void> {
    const processingTime = Date.now() - (job.processedOn || Date.now());

    this.logger.error(`Job ${job.id} failed`, error, {
      queueName,
      workerId,
      jobName: job.name,
      processingTime,
      attemptsMade: job.attemptsMade,
    });
  }

  /**
   * Setup periodic health checks
   */
  private setupHealthChecks(): void {
    const checkInterval = 60000; // Check every minute

    this.healthCheckInterval = setInterval(async () => {
      await this.checkWorkerHealth();
    }, checkInterval);

    this.logger.debug('Worker health checks enabled', { interval: checkInterval });
  }

  /**
   * Check health of all workers
   */
  private async checkWorkerHealth(): Promise<void> {
    const workers = Array.from(this.workers.values());

    for (const worker of workers) {
      const { id, status, queueName } = worker;

      // Check if worker is stalled (no activity for too long)
      const inactiveDuration = status.lastActive
        ? Date.now() - status.lastActive
        : Date.now() - worker.startedAt;

      const stalledThreshold = 300000; // 5 minutes

      if (status.activeJobs > 0 && inactiveDuration > stalledThreshold) {
        this.logger.warn(`Worker ${id} appears to be stalled`, {
          queueName,
          inactiveDuration,
          activeJobs: status.activeJobs,
        });
      }
    }
  }

  /**
   * Generate unique worker ID
   */
  private generateWorkerId(queueName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `worker-${queueName}-${timestamp}-${random}`;
  }

  /**
   * Get default processor (logs a warning)
   */
  private getDefaultProcessor(): JobProcessor {
    return async (job: any) => {
      this.logger.warn(`Default processor called for job ${job.id}`, {
        jobName: job.name,
        data: job.data,
      });
      return { success: true, message: 'Processed by default processor' };
    };
  }
}
