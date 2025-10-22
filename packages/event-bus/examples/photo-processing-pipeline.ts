/**
 * Photo Processing Pipeline Example
 *
 * Demonstrates a complete photo processing workflow using Event Bus:
 * - API service publishes upload events
 * - Worker service processes photos with progress updates
 * - Notification service sends user notifications
 */

import { EventBusClient, EventBusConfig } from '@shared-infra/event-bus';
import { v4 as uuidv4 } from 'uuid';

// Simulated services configuration
const createEventBus = (serviceName: string): EventBusClient => {
  const config: EventBusConfig = {
    serviceName,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      keyPrefix: 'eventbus:',
    },
    logLevel: 'info',
  };

  return new EventBusClient(config);
};

/**
 * API Service - Handles photo uploads
 */
async function apiService() {
  const eventBus = createEventBus('photo-api-service');
  await eventBus.connect();
  console.log('[API] Service started');

  // Simulate photo upload
  const uploadPhoto = async (userId: string, filename: string) => {
    const photoId = uuidv4();

    console.log(`\n[API] User ${userId} uploaded photo: ${filename}`);

    // Publish photo uploaded event
    await eventBus.publish('photo.uploaded', {
      photoId,
      userId,
      filename,
      size: Math.floor(Math.random() * 5000000) + 1000000, // 1-5MB
      mimeType: 'image/jpeg',
      uploadedAt: new Date().toISOString(),
    });

    console.log(`[API] Published photo.uploaded event for ${photoId}`);

    return photoId;
  };

  return { eventBus, uploadPhoto };
}

/**
 * Worker Service - Processes uploaded photos
 */
async function workerService() {
  const eventBus = createEventBus('photo-worker-service');
  await eventBus.connect();
  console.log('[WORKER] Service started');

  // Subscribe to photo upload events
  await eventBus.subscribe('photo.uploaded', async event => {
    const { photoId, userId, filename } = event.data;
    const jobId = uuidv4();
    const startTime = Date.now();

    console.log(`\n[WORKER] Processing photo ${photoId} (${filename})`);

    try {
      // Publish processing started event
      await eventBus.publish('photo.processing.started', {
        photoId,
        userId,
        jobId,
        startedAt: new Date().toISOString(),
        estimatedDuration: 30,
      });

      // Processing stages
      const stages = [
        { name: 'validation', duration: 500 },
        { name: 'resize', duration: 1000 },
        { name: 'thumbnail-generation', duration: 1500 },
        { name: 'optimization', duration: 1000 },
        { name: 'storage', duration: 500 },
      ];

      let totalProgress = 0;
      const progressPerStage = 100 / stages.length;

      // Process each stage
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        console.log(`[WORKER] Stage ${i + 1}/${stages.length}: ${stage.name}`);

        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, stage.duration));

        totalProgress += progressPerStage;

        // Publish progress event
        await eventBus.publish('photo.processing.progress', {
          photoId,
          userId,
          jobId,
          progress: Math.round(totalProgress),
          stage: stage.name,
          currentStep: `${i + 1}/${stages.length}`,
          estimatedCompletion: new Date(
            Date.now() + stages.slice(i + 1).reduce((sum, s) => sum + s.duration, 0)
          ).toISOString(),
        });

        // Publish stage completed event
        await eventBus.publish('photo.processing.stage.completed', {
          photoId,
          userId,
          jobId,
          stage: stage.name,
          completedAt: new Date().toISOString(),
          duration: stage.duration,
          nextStage: stages[i + 1]?.name,
        });
      }

      const totalDuration = Date.now() - startTime;

      // Publish processing completed event
      await eventBus.publish('photo.processing.completed', {
        photoId,
        userId,
        jobId,
        completedAt: new Date().toISOString(),
        duration: totalDuration,
        thumbnails: [
          {
            size: 'small',
            width: 150,
            height: 150,
            url: `https://cdn.example.com/thumbnails/small/${photoId}.jpg`,
            path: `thumbnails/small/${photoId}.jpg`,
          },
          {
            size: 'medium',
            width: 300,
            height: 300,
            url: `https://cdn.example.com/thumbnails/medium/${photoId}.jpg`,
            path: `thumbnails/medium/${photoId}.jpg`,
          },
          {
            size: 'large',
            width: 800,
            height: 800,
            url: `https://cdn.example.com/thumbnails/large/${photoId}.jpg`,
            path: `thumbnails/large/${photoId}.jpg`,
          },
        ],
        metadata: {
          width: 1920,
          height: 1080,
          format: 'jpeg',
          colorSpace: 'sRGB',
          hasAlpha: false,
        },
        storageInfo: {
          bucket: 'photos-production',
          key: `originals/${photoId}.jpg`,
          size: event.data.size,
          contentType: 'image/jpeg',
        },
      });

      console.log(`[WORKER] ✓ Photo ${photoId} processed successfully in ${totalDuration}ms`);
    } catch (error: any) {
      // Publish processing failed event
      await eventBus.publish('photo.processing.failed', {
        photoId,
        userId,
        jobId,
        failedAt: new Date().toISOString(),
        error: {
          code: error.code || 'PROCESSING_ERROR',
          message: error.message || 'Photo processing failed',
          details: {},
        },
        retryable: true,
        retryCount: 0,
      });

      console.error(`[WORKER] ✗ Photo ${photoId} processing failed:`, error.message);
    }
  });

  console.log('[WORKER] Subscribed to photo.uploaded events');

  return { eventBus };
}

/**
 * Notification Service - Sends user notifications
 */
async function notificationService() {
  const eventBus = createEventBus('notification-service');
  await eventBus.connect();
  console.log('[NOTIFICATION] Service started');

  // Subscribe to processing started events
  await eventBus.subscribe('photo.processing.started', async event => {
    const { photoId, userId } = event.data;

    console.log(`\n[NOTIFICATION] → User ${userId}: Photo processing started (${photoId})`);

    // In a real app, this would send a push notification, email, etc.
    await eventBus.publishToUser(userId, 'notification.new', {
      type: 'photo_processing_started',
      title: 'Processing Your Photo',
      message: 'Your photo is being processed...',
      photoId,
      timestamp: new Date().toISOString(),
    });
  });

  // Subscribe to processing progress events (throttled)
  const lastProgressUpdate: Record<string, number> = {};
  await eventBus.subscribe('photo.processing.progress', async event => {
    const { photoId, userId, progress, stage } = event.data;

    // Throttle progress updates (only send every 25%)
    const lastProgress = lastProgressUpdate[photoId] || 0;
    if (progress - lastProgress >= 25) {
      console.log(`[NOTIFICATION] → User ${userId}: Processing ${progress}% - ${stage}`);
      lastProgressUpdate[photoId] = progress;

      await eventBus.publishToUser(userId, 'notification.new', {
        type: 'photo_processing_progress',
        title: 'Processing...',
        message: `${progress}% complete - ${stage}`,
        photoId,
        progress,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Subscribe to processing completed events
  await eventBus.subscribe('photo.processing.completed', async event => {
    const { photoId, userId, thumbnails } = event.data;

    console.log(`\n[NOTIFICATION] ✓ User ${userId}: Photo ready! (${photoId})`);

    // Clean up throttle tracking
    delete lastProgressUpdate[photoId];

    await eventBus.publishToUser(userId, 'notification.new', {
      type: 'photo_processing_completed',
      title: 'Your Photo is Ready!',
      message: 'Photo processing completed successfully',
      photoId,
      thumbnailUrl: thumbnails[0]?.url,
      link: `/photos/${photoId}`,
      timestamp: new Date().toISOString(),
    });
  });

  // Subscribe to processing failed events
  await eventBus.subscribe('photo.processing.failed', async event => {
    const { photoId, userId, error } = event.data;

    console.log(`\n[NOTIFICATION] ✗ User ${userId}: Photo processing failed (${photoId})`);

    // Clean up throttle tracking
    delete lastProgressUpdate[photoId];

    await eventBus.publishToUser(userId, 'notification.new', {
      type: 'photo_processing_failed',
      title: 'Photo Processing Failed',
      message: `Failed: ${error.message}`,
      photoId,
      severity: 'error',
      timestamp: new Date().toISOString(),
    });
  });

  console.log('[NOTIFICATION] Subscribed to processing events');

  return { eventBus };
}

/**
 * Analytics Service - Tracks processing metrics
 */
async function analyticsService() {
  const eventBus = createEventBus('analytics-service');
  await eventBus.connect();
  console.log('[ANALYTICS] Service started');

  const metrics = {
    totalUploads: 0,
    totalProcessed: 0,
    totalFailed: 0,
    averageProcessingTime: 0,
    processingTimes: [] as number[],
  };

  // Track all photo events
  await eventBus.subscribe('photo.*', async event => {
    switch (event.type) {
      case 'photo.uploaded':
        metrics.totalUploads++;
        break;

      case 'photo.processing.completed':
        metrics.totalProcessed++;
        metrics.processingTimes.push(event.data.duration);
        metrics.averageProcessingTime =
          metrics.processingTimes.reduce((a, b) => a + b, 0) / metrics.processingTimes.length;
        break;

      case 'photo.processing.failed':
        metrics.totalFailed++;
        break;
    }
  });

  console.log('[ANALYTICS] Subscribed to photo events');

  const getMetrics = () => metrics;

  return { eventBus, getMetrics };
}

/**
 * Main execution
 */
async function main() {
  console.log('=== Photo Processing Pipeline Demo ===\n');

  try {
    // Start all services
    console.log('--- Starting Services ---\n');
    const api = await apiService();
    const worker = await workerService();
    const notification = await notificationService();
    const analytics = await analyticsService();

    // Give services time to connect and subscribe
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('\n--- Simulating Photo Uploads ---\n');

    // Simulate multiple photo uploads
    const uploads = [
      { userId: 'user-001', filename: 'vacation-beach.jpg' },
      { userId: 'user-002', filename: 'family-portrait.jpg' },
      { userId: 'user-001', filename: 'sunset.jpg' },
    ];

    for (const upload of uploads) {
      await api.uploadPhoto(upload.userId, upload.filename);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for all processing to complete
    console.log('\n--- Waiting for Processing to Complete ---\n');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Display analytics
    console.log('\n--- Analytics Report ---\n');
    const metrics = analytics.getMetrics();
    console.log(`Total uploads: ${metrics.totalUploads}`);
    console.log(`Successfully processed: ${metrics.totalProcessed}`);
    console.log(`Failed: ${metrics.totalFailed}`);
    console.log(`Average processing time: ${Math.round(metrics.averageProcessingTime)}ms`);

    // Display Event Bus stats
    console.log('\n--- Event Bus Statistics ---\n');
    const stats = await api.eventBus.getStats();
    console.log(`Total events published: ${stats.eventsPublished}`);
    console.log(`Total events received: ${stats.eventsReceived}`);
    console.log(`Total events delivered: ${stats.eventsDelivered}`);
    console.log(`Active subscriptions: ${stats.activeSubscriptions}`);

    // Cleanup
    console.log('\n--- Shutting Down Services ---\n');
    await api.eventBus.disconnect();
    await worker.eventBus.disconnect();
    await notification.eventBus.disconnect();
    await analytics.eventBus.disconnect();

    console.log('All services stopped successfully');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  main().catch(console.error);
}

export { apiService, workerService, notificationService, analyticsService };
