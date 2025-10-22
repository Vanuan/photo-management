/**
 * Basic Usage Examples for @shared-infra/job-queue
 *
 * This file demonstrates common usage patterns for the Job Queue Coordinator library.
 */

import {
  createJobQueueCoordinator,
  createSimpleConfig,
  JobQueueCoordinator,
  DEFAULT_QUEUE_CONFIGS,
  PhotoProcessingJob,
} from '../src';

// ============================================================================
// 1. SETUP AND INITIALIZATION
// ============================================================================

async function setupCoordinator(): Promise<JobQueueCoordinator> {
  console.log('🚀 Setting up Job Queue Coordinator...');

  // Simple configuration
  const coordinator = createJobQueueCoordinator(
    createSimpleConfig(process.env.REDIS_HOST || 'localhost', 6379)
  );

  // Or use full configuration
  const coordinatorFull = createJobQueueCoordinator({
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: 0,
      keyPrefix: 'photo-app:',
    },
    queues: [
      DEFAULT_QUEUE_CONFIGS.photoProcessing,
      DEFAULT_QUEUE_CONFIGS.background,
    ],
    logging: {
      level: 'info',
      format: 'json',
    },
    metrics: {
      enabled: true,
      collectInterval: 60000,
    },
  });

  // Initialize coordinator
  await coordinator.initialize();
  console.log('✅ Coordinator initialized successfully');

  return coordinator;
}

// ============================================================================
// 2. PRODUCER USAGE (API Service)
// ============================================================================

async function producerExample(coordinator: JobQueueCoordinator) {
  console.log('\n📤 Producer Examples (API Service)...');

  // Create a queue for photo processing
  await coordinator.createQueue({
    name: 'photo-processing',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      timeout: 60000,
    },
  });

  // Example 1: Simple job enqueueing
  const simpleJob = await coordinator.enqueueJob('photo-processing', {
    photoId: 'photo-123',
    operation: 'thumbnail',
  });
  console.log(`✅ Simple job enqueued: ${simpleJob.id}`);

  // Example 2: Job with priority
  const urgentJob = await coordinator.enqueueJob(
    'photo-processing',
    {
      photoId: 'photo-456',
      operation: 'urgent-processing',
    },
    {
      priority: 1, // Highest priority
    }
  );
  console.log(`✅ Urgent job enqueued: ${urgentJob.id}`);

  // Example 3: Delayed job
  const delayedJob = await coordinator.enqueueJob(
    'photo-processing',
    {
      photoId: 'photo-789',
      operation: 'scheduled-processing',
    },
    {
      delay: 60000, // Process after 1 minute
    }
  );
  console.log(`✅ Delayed job enqueued: ${delayedJob.id}`);

  // Example 4: Named job with custom options
  const namedJob = await coordinator.enqueueNamedJob(
    'photo-processing',
    'process-photo',
    {
      photoId: 'photo-abc',
      userId: 'user-123',
      operations: ['thumbnail', 'resize', 'watermark'],
    },
    {
      maxRetries: 5,
      timeout: 120000,
    }
  );
  console.log(`✅ Named job enqueued: ${namedJob.id}`);

  // Example 5: Bulk job enqueueing
  const bulkJobs = await coordinator.bulkEnqueueJobs('photo-processing', [
    {
      name: 'batch-process-1',
      data: { photoId: 'photo-001', operation: 'resize' },
    },
    {
      name: 'batch-process-2',
      data: { photoId: 'photo-002', operation: 'resize' },
    },
    {
      name: 'batch-process-3',
      data: { photoId: 'photo-003', operation: 'resize' },
    },
  ]);
  console.log(`✅ Bulk enqueued ${bulkJobs.length} jobs`);

  // Example 6: Recurring job (cron-based)
  const recurringJob = await coordinator.scheduleRecurringJob(
    'photo-processing',
    'daily-cleanup',
    {
      operation: 'cleanup-temp-files',
      olderThanDays: 7,
    },
    {
      cronExpression: '0 2 * * *', // Every day at 2 AM
      timezone: 'America/New_York',
    }
  );
  console.log(`✅ Recurring job scheduled: ${recurringJob.id}`);
}

// ============================================================================
// 3. CONSUMER USAGE (Worker Service)
// ============================================================================

async function consumerExample(coordinator: JobQueueCoordinator) {
  console.log('\n📥 Consumer Examples (Worker Service)...');

  // Ensure queue exists
  await coordinator.createQueue({
    name: 'photo-processing',
    defaultJobOptions: {
      attempts: 3,
    },
  });

  // Example 1: Simple worker registration
  await coordinator.registerWorker('photo-processing', async (job) => {
    console.log(`🔄 Processing job ${job.id}: ${job.name}`);

    const { photoId, operation } = job.data;

    // Simulate processing with progress updates
    await job.updateProgress(0);
    await job.log(`Starting ${operation} for photo ${photoId}`);

    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await job.updateProgress(50);
    await job.log(`Halfway through ${operation}`);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await job.updateProgress(100);
    await job.log(`Completed ${operation}`);

    return {
      success: true,
      photoId,
      operation,
      processedAt: new Date().toISOString(),
    };
  });
  console.log('✅ Simple worker registered');

  // Example 2: Worker with concurrency
  await coordinator.registerWorker(
    'photo-processing',
    async (job) => {
      // Process job
      return { success: true };
    },
    {
      concurrency: 5, // Process 5 jobs concurrently
    }
  );
  console.log('✅ Concurrent worker registered');

  // Example 3: Worker with rate limiting
  await coordinator.registerWorker(
    'photo-processing',
    async (job) => {
      // Process job
      return { success: true };
    },
    {
      concurrency: 10,
      limiter: {
        max: 100, // Maximum 100 jobs
        duration: 1000, // Per second
      },
    }
  );
  console.log('✅ Rate-limited worker registered');
}

// ============================================================================
// 4. PHOTO PROCESSING EXAMPLE (Domain-Specific)
// ============================================================================

async function photoProcessingExample(coordinator: JobQueueCoordinator) {
  console.log('\n📷 Photo Processing Example...');

  // Create photo processing queue
  await coordinator.createQueue(DEFAULT_QUEUE_CONFIGS.photoProcessing);

  // Register comprehensive photo processor
  await coordinator.registerWorker<PhotoProcessingJob>(
    'photo-processing',
    async (job, context) => {
      const { photoId, userId, pipeline, storage, processing } = job.data;

      console.log(`📸 Processing photo ${photoId} for user ${userId}`);

      let completedStages = 0;
      const totalStages = processing.stages.length;

      for (const stage of processing.stages) {
        try {
          await job.log(`Processing stage: ${stage.name} (${stage.type})`);

          // Simulate stage processing
          switch (stage.type) {
            case 'thumbnail':
              await generateThumbnails(photoId, storage);
              break;
            case 'resize':
              await resizeImage(photoId, storage);
              break;
            case 'watermark':
              await applyWatermark(photoId, storage);
              break;
            case 'compress':
              await compressImage(photoId, storage);
              break;
            case 'metadata-extraction':
              await extractMetadata(photoId, storage);
              break;
          }

          completedStages++;
          const progress = (completedStages / totalStages) * 100;
          await job.updateProgress(progress);

          await job.log(`Stage ${stage.name} completed`);
        } catch (error) {
          await job.log(`Stage ${stage.name} failed: ${(error as Error).message}`);
          throw error;
        }
      }

      return {
        success: true,
        photoId,
        userId,
        completedStages: processing.stages.map((s) => s.name),
        processedAt: new Date().toISOString(),
      };
    },
    {
      concurrency: 3,
    }
  );

  // Enqueue a photo processing job
  const job = await coordinator.enqueueNamedJob<PhotoProcessingJob>(
    'photo-processing',
    'process-photo',
    {
      type: 'photo-processing',
      photoId: 'photo-xyz-789',
      userId: 'user-456',
      pipeline: {
        name: 'standard-processing',
        stages: ['thumbnail', 'resize', 'watermark'],
        parallel: false,
      },
      storage: {
        sourceKey: 'uploads/photo-xyz-789.jpg',
        bucket: 'user-uploads',
        region: 'us-east-1',
      },
      processing: {
        stages: [
          {
            name: 'generate-thumbnails',
            type: 'thumbnail',
            config: {
              sizes: [
                { width: 150, height: 150 },
                { width: 300, height: 300 },
              ],
            },
          },
          {
            name: 'resize-image',
            type: 'resize',
            config: {
              width: 1920,
              height: 1080,
            },
          },
          {
            name: 'add-watermark',
            type: 'watermark',
            config: {
              text: '© 2024 PhotoApp',
              position: 'bottom-right',
            },
          },
        ],
      },
    },
    {
      priority: 2,
      maxRetries: 3,
      timeout: 120000,
    }
  );

  console.log(`✅ Photo processing job enqueued: ${job.id}`);
}

// ============================================================================
// 5. MONITORING AND MANAGEMENT
// ============================================================================

async function monitoringExample(coordinator: JobQueueCoordinator) {
  console.log('\n📊 Monitoring Examples...');

  // Example 1: Get queue status
  const queueStatus = await coordinator.getQueueStatus('photo-processing');
  if (queueStatus) {
    console.log('📈 Queue Status:', {
      name: queueStatus.name,
      waiting: queueStatus.counts.waiting,
      active: queueStatus.counts.active,
      completed: queueStatus.counts.completed,
      failed: queueStatus.counts.failed,
      health: queueStatus.health.status,
    });
  }

  // Example 2: Get all queues status
  const allStatuses = await coordinator.getAllQueueStatus();
  console.log(`📊 Total queues: ${allStatuses.length}`);

  // Example 3: Get overall health
  const health = await coordinator.getHealth();
  console.log('🏥 System Health:', {
    status: health.status,
    totalQueues: health.queues.length,
    totalWorkers: health.workers.total,
    activeWorkers: health.workers.active,
  });

  // Example 4: Get worker status
  const workerStatus = coordinator.getWorkerStatus('photo-processing');
  console.log(`👷 Workers for photo-processing: ${workerStatus.length}`);
  workerStatus.forEach((worker) => {
    console.log(`  - Worker ${worker.id}: ${worker.processedJobs} processed`);
  });

  // Example 5: Get failed jobs
  const failedJobs = await coordinator.getFailedJobs('photo-processing', 0, 10);
  console.log(`❌ Failed jobs: ${failedJobs.length}`);

  // Example 6: Retry failed job
  if (failedJobs.length > 0) {
    const jobToRetry = failedJobs[0];
    const retried = await coordinator.retryJob('photo-processing', jobToRetry.id);
    console.log(`🔄 Job ${jobToRetry.id} retry: ${retried ? 'Success' : 'Failed'}`);
  }

  // Example 7: Get jobs by state
  const waitingJobs = await coordinator.getJobsByState('photo-processing', 'waiting', 0, 10);
  console.log(`⏳ Waiting jobs: ${waitingJobs.length}`);

  // Example 8: Scale workers
  const scalingResult = await coordinator.scaleWorkers('photo-processing', 5);
  console.log(`📈 Scaling result:`, {
    success: scalingResult.success,
    previousCount: scalingResult.previousCount,
    newCount: scalingResult.newCount,
  });
}

// ============================================================================
// 6. ERROR HANDLING EXAMPLE
// ============================================================================

async function errorHandlingExample(coordinator: JobQueueCoordinator) {
  console.log('\n⚠️ Error Handling Example...');

  await coordinator.createQueue({ name: 'error-test-queue' });

  // Register worker with error handling
  await coordinator.registerWorker('error-test-queue', async (job) => {
    const { shouldFail, retryable } = job.data;

    if (shouldFail) {
      await job.log(`Job will fail (retryable: ${retryable})`);

      if (retryable) {
        // Throw error to trigger retry
        throw new Error('Temporary failure - will retry');
      } else {
        // Throw non-retryable error
        throw new Error('FATAL: Non-retryable failure');
      }
    }

    return { success: true };
  });

  // Enqueue job that will be retried
  await coordinator.enqueueJob(
    'error-test-queue',
    { shouldFail: true, retryable: true },
    { maxRetries: 3 }
  );

  console.log('✅ Error handling worker registered');
}

// ============================================================================
// 7. GRACEFUL SHUTDOWN
// ============================================================================

function setupGracefulShutdown(coordinator: JobQueueCoordinator) {
  console.log('\n🛑 Setting up graceful shutdown handlers...');

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);

    try {
      // Shutdown coordinator (closes workers and queues)
      await coordinator.shutdown();
      console.log('✅ Coordinator shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ============================================================================
// HELPER FUNCTIONS (Simulated)
// ============================================================================

async function generateThumbnails(photoId: string, storage: any): Promise<void> {
  // Simulate thumbnail generation
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function resizeImage(photoId: string, storage: any): Promise<void> {
  // Simulate image resizing
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function applyWatermark(photoId: string, storage: any): Promise<void> {
  // Simulate watermark application
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function compressImage(photoId: string, storage: any): Promise<void> {
  // Simulate image compression
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function extractMetadata(photoId: string, storage: any): Promise<void> {
  // Simulate metadata extraction
  await new Promise((resolve) => setTimeout(resolve, 200));
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('🎯 Job Queue Coordinator - Basic Usage Examples\n');
  console.log('='.repeat(60));

  let coordinator: JobQueueCoordinator | null = null;

  try {
    // Setup
    coordinator = await setupCoordinator();

    // Setup graceful shutdown
    setupGracefulShutdown(coordinator);

    // Run examples
    await producerExample(coordinator);
    await consumerExample(coordinator);
    await photoProcessingExample(coordinator);
    await monitoringExample(coordinator);
    await errorHandlingExample(coordinator);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All examples completed successfully!');
    console.log('\nPress Ctrl+C to exit...');

    // Keep process alive to observe workers
    await new Promise(() => {}); // Wait indefinitely
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

// Export for use in other modules
export {
  setupCoordinator,
  producerExample,
  consumerExample,
  photoProcessingExample,
  monitoringExample,
  errorHandlingExample,
};
