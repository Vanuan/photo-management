/**
 * Job Scheduler - Handles job scheduling and recurring jobs
 * @module @shared-infra/job-queue/core/job-scheduler
 */

import { Job } from 'bullmq';
import { ScheduleOptions, RecurringJobOptions, RepeatableJob, JobOptions } from '../types';
import { QueueManager } from './queue-manager';
import { Logger, createLogger } from '../utils/logger';

export class JobScheduler {
  private queueManager: QueueManager;
  private logger: Logger;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
    this.logger = createLogger(undefined, { component: 'JobScheduler' });
  }

  /**
   * Schedule a one-time job
   */
  async scheduleJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options?: ScheduleOptions
  ): Promise<Job<T>> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found. Create queue first.`);
    }

    const traceId = this.generateTraceId();

    this.logger.info(`Scheduling job ${jobName} in queue ${queueName}`, {
      jobName,
      queueName,
      traceId,
      options,
    });

    try {
      const jobOptions: JobOptions = {
        jobId: options?.jobId,
        priority: options?.priority,
        delay: options?.delayMs,
        attempts: options?.maxRetries || 3,
        backoff: options?.backoffStrategy || {
          type: 'exponential',
          delay: 2000,
        },
        timeout: options?.timeout,
      };

      const job = await queue.add(jobName, data, jobOptions);

      this.logger.info(`Job ${jobName} scheduled successfully`, {
        jobId: job.id,
        queueName,
        traceId,
      });

      return job;
    } catch (error) {
      this.logger.error(`Failed to schedule job ${jobName}`, error as Error, {
        queueName,
        traceId,
      });
      throw error;
    }
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
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found. Create queue first.`);
    }

    const { cronExpression, timezone, startDate, endDate, limit, ...scheduleOptions } = options;

    // Validate cron expression
    if (!this.isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const traceId = this.generateTraceId();

    this.logger.info(`Scheduling recurring job ${jobName} in queue ${queueName}`, {
      jobName,
      queueName,
      cronExpression,
      timezone,
      traceId,
    });

    try {
      const jobOptions: JobOptions = {
        jobId: scheduleOptions?.jobId,
        priority: scheduleOptions?.priority,
        attempts: scheduleOptions?.maxRetries || 3,
        backoff: scheduleOptions?.backoffStrategy || {
          type: 'exponential',
          delay: 2000,
        },
        timeout: scheduleOptions?.timeout,
        repeat: {
          cron: cronExpression,
          ...(timezone && { tz: timezone }),
          ...(startDate && { startDate }),
          ...(endDate && { endDate }),
          ...(limit && { limit }),
        },
      };

      const job = await queue.add(jobName, data, jobOptions);

      const nextRun = this.calculateNextRun(cronExpression, timezone);

      this.logger.info(`Recurring job ${jobName} scheduled successfully`, {
        jobId: job.id,
        queueName,
        cronExpression,
        nextRun: new Date(nextRun).toISOString(),
        traceId,
      });

      return job;
    } catch (error) {
      this.logger.error(`Failed to schedule recurring job ${jobName}`, error as Error, {
        queueName,
        cronExpression,
        traceId,
      });
      throw error;
    }
  }

  /**
   * Get all repeatable jobs for a queue
   */
  async getRepeatableJobs(queueName: string): Promise<RepeatableJob[]> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const repeatableJobs = await queue.getRepeatableJobs();

      return repeatableJobs.map(job => ({
        id: job.key,
        name: job.name,
        queueName,
        cronExpression: job.pattern || '',
        nextRun: job.next || Date.now(),
        options: {
          cronExpression: job.pattern || '',
          timezone: job.tz || undefined,
          priority: undefined,
        },
      }));
    } catch (error) {
      this.logger.error(`Failed to get repeatable jobs for queue ${queueName}`, error as Error);
      throw error;
    }
  }

  /**
   * Remove a repeatable job
   */
  async removeRepeatableJob(
    queueName: string,
    jobName: string,
    repeatOptions: { cron?: string; every?: number }
  ): Promise<boolean> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const removed = await queue.removeRepeatableByKey(
        this.getRepeatableKey(jobName, repeatOptions)
      );

      if (removed) {
        this.logger.info(`Removed repeatable job ${jobName} from queue ${queueName}`, {
          repeatOptions,
        });
      } else {
        this.logger.warn(`Repeatable job ${jobName} not found in queue ${queueName}`);
      }

      return removed;
    } catch (error) {
      this.logger.error(`Failed to remove repeatable job ${jobName}`, error as Error, {
        queueName,
      });
      throw error;
    }
  }

  /**
   * Update job priority (for waiting/delayed jobs)
   */
  async updateJobPriority(queueName: string, jobId: string, priority: number): Promise<boolean> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        this.logger.warn(`Job ${jobId} not found in queue ${queueName}`);
        return false;
      }

      // Can only change priority for waiting or delayed jobs
      const state = await job.getState();
      if (state !== 'waiting' && state !== 'delayed') {
        this.logger.warn(`Cannot change priority for job ${jobId} in state ${state}`);
        return false;
      }

      await job.changePriority({ priority });

      this.logger.info(`Updated priority for job ${jobId}`, {
        queueName,
        jobId,
        newPriority: priority,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to update priority for job ${jobId}`, error as Error, {
        queueName,
      });
      throw error;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<Job | null> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const job = await queue.getJob(jobId);
      return job || null;
    } catch (error) {
      this.logger.error(`Failed to get job ${jobId}`, error as Error, {
        queueName,
      });
      throw error;
    }
  }

  /**
   * Cancel a job (remove if waiting/delayed, or mark as cancelled)
   */
  async cancelJob(queueName: string, jobId: string): Promise<boolean> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        this.logger.warn(`Job ${jobId} not found in queue ${queueName}`);
        return false;
      }

      const state = await job.getState();

      // For waiting or delayed jobs, remove them
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
        this.logger.info(`Removed job ${jobId} from queue ${queueName}`, { state });
        return true;
      }

      // For active jobs, can't directly cancel but can mark as failed
      if (state === 'active') {
        this.logger.warn(`Cannot cancel active job ${jobId}, marking as failed`);
        await job.moveToFailed(new Error('Job cancelled by user'), '0', true);
        return true;
      }

      this.logger.warn(`Job ${jobId} is in state ${state}, cannot cancel`);
      return false;
    } catch (error) {
      this.logger.error(`Failed to cancel job ${jobId}`, error as Error, {
        queueName,
      });
      throw error;
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(queueName: string, jobId: string): Promise<boolean> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const job = await queue.getJob(jobId);
      if (!job) {
        this.logger.warn(`Job ${jobId} not found in queue ${queueName}`);
        return false;
      }

      const state = await job.getState();
      if (state !== 'failed') {
        this.logger.warn(`Job ${jobId} is not in failed state (${state})`);
        return false;
      }

      await job.retry();

      this.logger.info(`Retrying job ${jobId} in queue ${queueName}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to retry job ${jobId}`, error as Error, {
        queueName,
      });
      throw error;
    }
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
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const jobs = await queue.getJobs([state], start, end);
      return jobs;
    } catch (error) {
      this.logger.error(`Failed to get ${state} jobs for queue ${queueName}`, error as Error);
      throw error;
    }
  }

  /**
   * Bulk schedule jobs
   */
  async bulkScheduleJobs<T = any>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options?: ScheduleOptions }>
  ): Promise<Job<T>[]> {
    const queue = this.queueManager.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const traceId = this.generateTraceId();

    this.logger.info(`Bulk scheduling ${jobs.length} jobs in queue ${queueName}`, {
      queueName,
      jobCount: jobs.length,
      traceId,
    });

    try {
      const bullJobs = jobs.map(job => ({
        name: job.name,
        data: job.data,
        opts: {
          jobId: job.options?.jobId,
          priority: job.options?.priority,
          delay: job.options?.delayMs,
          attempts: job.options?.maxRetries || 3,
          backoff: job.options?.backoffStrategy || {
            type: 'exponential',
            delay: 2000,
          },
          timeout: job.options?.timeout,
        },
      }));

      const addedJobs = await queue.addBulk(bullJobs);

      this.logger.info(`Bulk scheduled ${addedJobs.length} jobs successfully`, {
        queueName,
        traceId,
      });

      return addedJobs;
    } catch (error) {
      this.logger.error(`Failed to bulk schedule jobs`, error as Error, {
        queueName,
        traceId,
      });
      throw error;
    }
  }

  /**
   * Generate a unique trace ID for tracking
   */
  private generateTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate cron expression (basic validation)
   */
  private isValidCronExpression(cron: string): boolean {
    // Basic cron validation (5 or 6 fields)
    const cronParts = cron.trim().split(/\s+/);
    return cronParts.length >= 5 && cronParts.length <= 6;
  }

  /**
   * Calculate next run time for a cron expression
   */
  private calculateNextRun(_cron: string, _timezone?: string): number {
    // Simple calculation - in production, use a proper cron parser library
    // For now, return a time 1 minute in the future
    return Date.now() + 60000;
  }

  /**
   * Get repeatable key for BullMQ
   */
  private getRepeatableKey(jobName: string, options: { cron?: string; every?: number }): string {
    if (options.cron) {
      return `${jobName}:${options.cron}:::`;
    }
    if (options.every) {
      return `${jobName}::${options.every}::`;
    }
    return jobName;
  }
}
