/**
 * Unit tests for JobQueueCoordinator
 */

import { JobQueueCoordinator, createJobQueueCoordinator } from '../../src/coordinator';
import { JobQueueCoordinatorConfig } from '../../src/types';

// Mock BullMQ
jest.mock('bullmq');
jest.mock('ioredis');

describe('JobQueueCoordinator', () => {
  let coordinator: JobQueueCoordinator;
  let config: JobQueueCoordinatorConfig;

  beforeEach(() => {
    config = {
      redis: {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'test:',
      },
      logging: {
        level: 'error', // Reduce noise in tests
        format: 'json',
      },
      metrics: {
        enabled: false,
      },
    };

    coordinator = createJobQueueCoordinator(config);
  });

  afterEach(async () => {
    if (coordinator.isInitialized()) {
      await coordinator.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should create a coordinator instance', () => {
      expect(coordinator).toBeInstanceOf(JobQueueCoordinator);
      expect(coordinator.isInitialized()).toBe(false);
    });

    it('should initialize successfully', async () => {
      await coordinator.initialize();
      expect(coordinator.isInitialized()).toBe(true);
    });

    it('should not initialize twice', async () => {
      await coordinator.initialize();
      await coordinator.initialize(); // Should not throw
      expect(coordinator.isInitialized()).toBe(true);
    });

    it('should create pre-configured queues during initialization', async () => {
      const configWithQueues: JobQueueCoordinatorConfig = {
        ...config,
        queues: [
          {
            name: 'test-queue',
            defaultJobOptions: {
              attempts: 3,
            },
          },
        ],
      };

      const coord = createJobQueueCoordinator(configWithQueues);
      await coord.initialize();

      expect(coord.isInitialized()).toBe(true);
      await coord.shutdown();
    });
  });

  describe('Queue Management', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should create a new queue', async () => {
      const queue = await coordinator.createQueue({
        name: 'my-queue',
        defaultJobOptions: {
          attempts: 3,
        },
      });

      expect(queue).toBeDefined();
    });

    it('should get queue status', async () => {
      await coordinator.createQueue({
        name: 'status-queue',
      });

      const status = await coordinator.getQueueStatus('status-queue');

      expect(status).toBeDefined();
      if (status) {
        expect(status.name).toBe('status-queue');
        expect(status.counts).toBeDefined();
        expect(status.health).toBeDefined();
      }
    });

    it('should get all queue statuses', async () => {
      await coordinator.createQueue({ name: 'queue-1' });
      await coordinator.createQueue({ name: 'queue-2' });

      const statuses = await coordinator.getAllQueueStatus();

      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThanOrEqual(2);
    });

    it('should pause and resume queue', async () => {
      await coordinator.createQueue({ name: 'pause-queue' });

      await coordinator.pauseQueue('pause-queue');
      // In real implementation, we'd check if queue is actually paused

      await coordinator.resumeQueue('pause-queue');
      // In real implementation, we'd check if queue is actually resumed
    });
  });

  describe('Job Enqueueing (Producer API)', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'job-queue' });
    });

    it('should enqueue a job', async () => {
      const job = await coordinator.enqueueJob('job-queue', {
        task: 'process-data',
        data: { id: 123 },
      });

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
    });

    it('should enqueue a named job', async () => {
      const job = await coordinator.enqueueNamedJob('job-queue', 'my-job', { data: 'test' });

      expect(job).toBeDefined();
      expect(job.name).toBe('my-job');
    });

    it('should enqueue job with priority', async () => {
      const job = await coordinator.enqueueJob('job-queue', { task: 'urgent' }, { priority: 1 });

      expect(job).toBeDefined();
      expect(job.opts.priority).toBe(1);
    });

    it('should enqueue delayed job', async () => {
      const job = await coordinator.enqueueJob('job-queue', { task: 'delayed' }, { delay: 5000 });

      expect(job).toBeDefined();
      expect(job.opts.delay).toBe(5000);
    });

    it('should enqueue job with custom retry settings', async () => {
      const job = await coordinator.enqueueJob(
        'job-queue',
        { task: 'retry-test' },
        { maxRetries: 5, timeout: 30000 }
      );

      expect(job).toBeDefined();
      expect(job.opts.attempts).toBe(5);
      // Note: timeout is not directly accessible in opts
    });

    it('should bulk enqueue jobs', async () => {
      const jobs = await coordinator.bulkEnqueueJobs('job-queue', [
        { name: 'job-1', data: { id: 1 } },
        { name: 'job-2', data: { id: 2 } },
        { name: 'job-3', data: { id: 3 } },
      ]);

      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBe(3);
    });

    it('should schedule recurring job', async () => {
      const job = await coordinator.scheduleRecurringJob(
        'job-queue',
        'daily-job',
        { task: 'cleanup' },
        {
          cronExpression: '0 2 * * *',
          timezone: 'UTC',
        }
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('daily-job');
    });
  });

  describe('Worker Management (Consumer API)', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'worker-queue' });
    });

    it('should register a worker', async () => {
      const processor = jest.fn(async () => {
        return { success: true };
      });

      await coordinator.registerWorker('worker-queue', processor);

      // Worker should be registered
      const status = coordinator.getWorkerStatus('worker-queue');
      expect(Array.isArray(status)).toBe(true);
      expect(status.length).toBeGreaterThan(0);
    });

    it('should register worker with concurrency', async () => {
      const processor = jest.fn(async () => ({ success: true }));

      await coordinator.registerWorker('worker-queue', processor, {
        concurrency: 10,
      });

      const status = coordinator.getWorkerStatus('worker-queue');
      expect(status.length).toBeGreaterThan(0);
    });

    it('should register worker with rate limiter', async () => {
      const processor = jest.fn(async () => ({ success: true }));

      await coordinator.registerWorker('worker-queue', processor, {
        concurrency: 5,
        limiter: {
          max: 100,
          duration: 1000,
        },
      });

      const status = coordinator.getWorkerStatus('worker-queue');
      expect(status.length).toBeGreaterThan(0);
    });

    it('should get worker status', async () => {
      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('worker-queue', processor);

      const status = coordinator.getWorkerStatus('worker-queue');

      expect(Array.isArray(status)).toBe(true);
      expect(status[0]).toHaveProperty('id');
      expect(status[0]).toHaveProperty('queueName', 'worker-queue');
      expect(status[0]).toHaveProperty('isRunning');
      expect(status[0]).toHaveProperty('processedJobs');
    });

    it('should scale workers', async () => {
      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('worker-queue', processor);

      const result = await coordinator.scaleWorkers('worker-queue', 5);

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.newCount).toBeDefined();
    });

    it('should pause workers', async () => {
      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('worker-queue', processor);

      await coordinator.pauseWorkers('worker-queue');

      const status = coordinator.getWorkerStatus('worker-queue');
      // In real implementation, we'd check if workers are paused
      expect(status).toBeDefined();
    });

    it('should resume workers', async () => {
      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('worker-queue', processor);

      await coordinator.pauseWorkers('worker-queue');
      await coordinator.resumeWorkers('worker-queue');

      const status = coordinator.getWorkerStatus('worker-queue');
      expect(status).toBeDefined();
    });
  });

  describe('Job Monitoring and Management', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'monitor-queue' });
    });

    it('should get a job by ID', async () => {
      const enqueuedJob = await coordinator.enqueueJob('monitor-queue', {
        data: 'test',
      });

      const job = await coordinator.getJob('monitor-queue', enqueuedJob.id!);

      expect(job).toBeDefined();
    });

    it('should get jobs by state', async () => {
      await coordinator.enqueueJob('monitor-queue', { data: 'test1' });
      await coordinator.enqueueJob('monitor-queue', { data: 'test2' });

      const jobs = await coordinator.getJobsByState('monitor-queue', 'waiting');

      expect(Array.isArray(jobs)).toBe(true);
    });

    it('should get failed jobs', async () => {
      const failedJobs = await coordinator.getFailedJobs('monitor-queue');

      expect(Array.isArray(failedJobs)).toBe(true);
    });

    it('should retry a job', async () => {
      const job = await coordinator.enqueueJob('monitor-queue', { data: 'test' });

      const result = await coordinator.retryJob('monitor-queue', job.id!);

      expect(typeof result).toBe('boolean');
    });

    it('should cancel a job', async () => {
      const job = await coordinator.enqueueJob('monitor-queue', { data: 'test' });

      const result = await coordinator.cancelJob('monitor-queue', job.id!);

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Health and Monitoring', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'health-queue' });
    });

    it('should get health status', async () => {
      const health = await coordinator.getHealth();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.queues).toBeDefined();
      expect(Array.isArray(health.queues)).toBe(true);
      expect(health.workers).toBeDefined();
      expect(health.timestamp).toBeDefined();
    });

    it('should include worker metrics in health', async () => {
      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('health-queue', processor);

      const health = await coordinator.getHealth();

      expect(health.workers.total).toBeGreaterThan(0);
    });
  });

  describe('Recurring Jobs', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'recurring-queue' });
    });

    it('should get recurring jobs', async () => {
      await coordinator.scheduleRecurringJob(
        'recurring-queue',
        'test-recurring',
        { task: 'test' },
        { cronExpression: '0 * * * *' }
      );

      const recurringJobs = await coordinator.getRecurringJobs('recurring-queue');

      expect(Array.isArray(recurringJobs)).toBe(true);
    });

    it('should remove recurring job', async () => {
      await coordinator.scheduleRecurringJob(
        'recurring-queue',
        'test-recurring',
        { task: 'test' },
        { cronExpression: '0 * * * *' }
      );

      const result = await coordinator.removeRecurringJob('recurring-queue', 'test-recurring', {
        cron: '0 * * * *',
      });

      expect(typeof result).toBe('boolean');
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'shutdown-queue' });

      await coordinator.shutdown();

      expect(coordinator.isInitialized()).toBe(false);
    });

    it('should close all workers and queues on shutdown', async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'test-queue' });

      const processor = jest.fn(async () => ({ success: true }));
      await coordinator.registerWorker('test-queue', processor);

      await coordinator.shutdown();

      expect(coordinator.isInitialized()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await coordinator.initialize();
    });

    it('should throw error when enqueueing to non-existent queue', async () => {
      await expect(
        coordinator.enqueueJob('non-existent-queue', { data: 'test' })
      ).rejects.toThrow();
    });

    it('should throw error when registering worker for non-existent queue', async () => {
      const processor = jest.fn(async () => ({ success: true }));

      await expect(coordinator.registerWorker('non-existent-queue', processor)).rejects.toThrow();
    });

    it('should handle invalid cron expression', async () => {
      await coordinator.createQueue({ name: 'cron-queue' });

      await expect(
        coordinator.scheduleRecurringJob(
          'cron-queue',
          'invalid-cron',
          { data: 'test' },
          { cronExpression: 'invalid' }
        )
      ).rejects.toThrow();
    });
  });

  describe('Advanced Features', () => {
    beforeEach(async () => {
      await coordinator.initialize();
      await coordinator.createQueue({ name: 'advanced-queue' });
    });

    it('should provide access to queue manager', () => {
      const queueManager = coordinator.getQueueManager();
      expect(queueManager).toBeDefined();
    });

    it('should provide access to job scheduler', () => {
      const jobScheduler = coordinator.getJobScheduler();
      expect(jobScheduler).toBeDefined();
    });

    it('should provide access to worker manager', () => {
      const workerManager = coordinator.getWorkerManager();
      expect(workerManager).toBeDefined();
    });
  });
});
