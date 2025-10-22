/**
 * Queue Manager - Manages BullMQ Queue instances
 * @module @shared-infra/job-queue/core/queue-manager
 */

import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { QueueConfig, QueueStatus, RedisConfig, CleanupPolicy } from '../types';
import { Logger, createLogger } from '../utils/logger';

export interface QueueManagerConfig {
  redis: RedisConfig;
  defaultCleanupPolicy?: CleanupPolicy;
  enableMetrics?: boolean;
}

export class QueueManager {
  private queues: Map<string, Queue>;
  private queueEvents: Map<string, QueueEvents>;
  private redis: Redis;
  private logger: Logger;
  private cleanupIntervals: Map<string, NodeJS.Timeout>;

  constructor(config: QueueManagerConfig) {
    this.queues = new Map();
    this.queueEvents = new Map();
    this.cleanupIntervals = new Map();
    this.logger = createLogger(undefined, { component: 'QueueManager' });

    // Create Redis connection
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      keyPrefix: config.redis.keyPrefix || 'bull:',
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest || 3,
      enableReadyCheck: config.redis.enableReadyCheck !== false,
      connectTimeout: config.redis.connectTimeout || 10000,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis connection established');
    });

    this.redis.on('error', error => {
      this.logger.error('Redis connection error', error);
    });
  }

  /**
   * Create a new queue or return existing one
   */
  async createQueue(queueConfig: QueueConfig): Promise<Queue> {
    const { name, defaultJobOptions, cleanupPolicy } = queueConfig;

    // Return existing queue if already created
    if (this.queues.has(name)) {
      this.logger.debug(`Queue ${name} already exists, returning existing instance`);
      return this.queues.get(name)!;
    }

    this.logger.info(`Creating queue: ${name}`, { config: queueConfig });

    try {
      // Create BullMQ Queue
      const queue = new Queue(name, {
        connection: this.redis.duplicate(),
        defaultJobOptions: {
          attempts: defaultJobOptions?.attempts || 3,
          backoff: defaultJobOptions?.backoff || {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete:
            defaultJobOptions?.removeOnComplete !== undefined
              ? defaultJobOptions.removeOnComplete
              : 100,
          removeOnFail:
            defaultJobOptions?.removeOnFail !== undefined ? defaultJobOptions.removeOnFail : false,
        },
      });

      // Create QueueEvents for listening to queue events
      const queueEvents = new QueueEvents(name, {
        connection: this.redis.duplicate(),
      });

      this.queues.set(name, queue);
      this.queueEvents.set(name, queueEvents);

      // Setup event handlers
      this.setupQueueEventHandlers(name, queue, queueEvents);

      // Setup automatic cleanup if policy is defined
      if (cleanupPolicy) {
        await this.setupQueueCleanup(name, queue, cleanupPolicy);
      }

      this.logger.info(`Queue ${name} created successfully`, {
        defaultJobOptions: queue.opts.defaultJobOptions,
      });

      return queue;
    } catch (error) {
      this.logger.error(`Failed to create queue ${name}`, error as Error);
      throw error;
    }
  }

  /**
   * Get an existing queue
   */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  /**
   * Get all queue names
   */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get status of a queue
   */
  async getQueueStatus(name: string): Promise<QueueStatus | null> {
    const queue = this.queues.get(name);
    if (!queue) {
      this.logger.warn(`Queue ${name} not found`);
      return null;
    }

    try {
      const [counts, isPaused] = await Promise.all([queue.getJobCounts(), queue.isPaused()]);

      // Calculate basic health metrics
      const totalJobs = counts.waiting + counts.active + counts.delayed;
      const errorRate = counts.failed > 0 ? counts.failed / (counts.completed + counts.failed) : 0;

      return {
        name,
        counts: {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          delayed: counts.delayed || 0,
          paused: counts.paused || 0,
        },
        isPaused,
        health: {
          status: this.determineHealthStatus(counts, errorRate),
          message: this.getHealthMessage(counts, errorRate),
          metrics: {
            processingRate: 0, // Will be calculated by metrics collector
            averageWaitTime: 0,
            averageProcessingTime: 0,
            errorRate,
            throughput: 0,
            queueDepth: totalJobs,
          },
          issues: [],
          lastCheck: Date.now(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get status for queue ${name}`, error as Error);
      return null;
    }
  }

  /**
   * Pause a queue
   */
  async pauseQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    await queue.pause();
    this.logger.info(`Queue ${name} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    await queue.resume();
    this.logger.info(`Queue ${name} resumed`);
  }

  /**
   * Close a queue and cleanup resources
   */
  async closeQueue(name: string): Promise<void> {
    const queue = this.queues.get(name);
    const queueEvents = this.queueEvents.get(name);
    const cleanupInterval = this.cleanupIntervals.get(name);

    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      this.cleanupIntervals.delete(name);
    }

    if (queueEvents) {
      await queueEvents.close();
      this.queueEvents.delete(name);
    }

    if (queue) {
      await queue.close();
      this.queues.delete(name);
      this.logger.info(`Queue ${name} closed`);
    }
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<void> {
    this.logger.info('Closing all queues');

    const closePromises = Array.from(this.queues.keys()).map(name => this.closeQueue(name));

    await Promise.all(closePromises);
    await this.redis.quit();

    this.logger.info('All queues closed');
  }

  /**
   * Setup event handlers for a queue
   */
  private setupQueueEventHandlers(name: string, queue: Queue, queueEvents: QueueEvents): void {
    // Queue level events
    queue.on('error', error => {
      this.logger.error(`Queue ${name} error`, error);
    });

    queue.on('paused', () => {
      this.logger.info(`Queue ${name} paused`);
    });

    queue.on('resumed', () => {
      this.logger.info(`Queue ${name} resumed`);
    });

    queue.on('cleaned', (jobs, type) => {
      this.logger.info(`Queue ${name} cleaned`, {
        jobCount: jobs.length,
        type,
      });
    });

    // QueueEvents for job lifecycle events
    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      this.logger.debug(`Job ${jobId} completed in queue ${name}`, {
        returnvalue,
      });
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      this.logger.warn(`Job ${jobId} failed in queue ${name}`, {
        reason: failedReason,
      });
    });

    queueEvents.on('progress', ({ jobId, data }) => {
      this.logger.debug(`Job ${jobId} progress in queue ${name}`, {
        progress: data,
      });
    });

    queueEvents.on('stalled', ({ jobId }) => {
      this.logger.warn(`Job ${jobId} stalled in queue ${name}`);
    });
  }

  /**
   * Setup automatic queue cleanup
   */
  private async setupQueueCleanup(
    name: string,
    queue: Queue,
    policy: CleanupPolicy
  ): Promise<void> {
    const cleanupInterval = 60 * 60 * 1000; // Run every hour

    const cleanup = async () => {
      try {
        this.logger.debug(`Running cleanup for queue ${name}`);

        const cleanupPromises: Promise<string[]>[] = [];

        // Clean completed jobs
        if (policy.completedJobsMaxAge) {
          cleanupPromises.push(queue.clean(policy.completedJobsMaxAge, 0, 'completed'));
        }
        if (policy.completedJobsMaxCount) {
          cleanupPromises.push(queue.clean(0, policy.completedJobsMaxCount, 'completed'));
        }

        // Clean failed jobs
        if (policy.failedJobsMaxAge) {
          cleanupPromises.push(queue.clean(policy.failedJobsMaxAge, 0, 'failed'));
        }
        if (policy.failedJobsMaxCount) {
          cleanupPromises.push(queue.clean(0, policy.failedJobsMaxCount, 'failed'));
        }

        const results = await Promise.all(cleanupPromises);
        const totalCleaned = results.reduce((sum, jobs) => sum + jobs.length, 0);

        if (totalCleaned > 0) {
          this.logger.info(`Cleaned ${totalCleaned} jobs from queue ${name}`);
        }
      } catch (error) {
        this.logger.error(`Cleanup failed for queue ${name}`, error as Error);
      }
    };

    // Run initial cleanup
    await cleanup();

    // Schedule periodic cleanup
    const interval = setInterval(cleanup, cleanupInterval);
    this.cleanupIntervals.set(name, interval);

    this.logger.info(`Cleanup scheduled for queue ${name}`, {
      interval: cleanupInterval,
      policy,
    });
  }

  /**
   * Determine health status based on queue metrics
   */
  private determineHealthStatus(
    counts: any,
    errorRate: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    const queueDepth = counts.waiting + counts.active + counts.delayed;

    // Unhealthy conditions
    if (errorRate > 0.5 || queueDepth > 10000) {
      return 'unhealthy';
    }

    // Degraded conditions
    if (errorRate > 0.2 || queueDepth > 5000) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get health message based on queue state
   */
  private getHealthMessage(counts: any, errorRate: number): string {
    const queueDepth = counts.waiting + counts.active + counts.delayed;

    if (errorRate > 0.5) {
      return `High error rate: ${(errorRate * 100).toFixed(1)}%`;
    }

    if (queueDepth > 10000) {
      return `Queue depth critical: ${queueDepth} jobs`;
    }

    if (queueDepth > 5000) {
      return `Queue depth high: ${queueDepth} jobs`;
    }

    if (errorRate > 0.2) {
      return `Elevated error rate: ${(errorRate * 100).toFixed(1)}%`;
    }

    return 'Queue operating normally';
  }

  /**
   * Get Redis connection
   */
  getRedisConnection(): Redis {
    return this.redis;
  }
}
