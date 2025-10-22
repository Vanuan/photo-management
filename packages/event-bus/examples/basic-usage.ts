/**
 * Basic Usage Example
 *
 * Demonstrates the core functionality of the Event Bus service:
 * - Connecting to the service
 * - Publishing events
 * - Subscribing to events
 * - Proper cleanup
 */

import { EventBusClient, EventBusConfig } from '@shared-infra/event-bus';

async function main() {
  // Configure the Event Bus client
  const config: EventBusConfig = {
    serviceName: 'example-service',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      keyPrefix: 'eventbus:',
    },
    logLevel: 'info',
  };

  // Create the Event Bus client
  const eventBus = new EventBusClient(config);

  try {
    // Connect to the Event Bus
    console.log('Connecting to Event Bus...');
    await eventBus.connect();
    console.log('Connected successfully!');

    // Subscribe to events before publishing
    console.log('\nSetting up event subscribers...');

    // Subscribe to all photo events
    await eventBus.subscribe('photo.*', async (event) => {
      console.log(`\n[RECEIVED] Photo event: ${event.type}`);
      console.log('Data:', JSON.stringify(event.data, null, 2));
      console.log('Metadata:', JSON.stringify(event.metadata, null, 2));
    });

    // Subscribe to specific event
    await eventBus.subscribe('photo.uploaded', async (event) => {
      console.log(`\n[HANDLER] Processing uploaded photo: ${event.data.photoId}`);
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log(`[HANDLER] Finished processing photo: ${event.data.photoId}`);
    });

    // Subscribe to user events
    await eventBus.subscribe('user.*', async (event) => {
      console.log(`\n[RECEIVED] User event: ${event.type}`);
      console.log('Data:', JSON.stringify(event.data, null, 2));
    });

    console.log('Subscribers ready!');

    // Give subscribers a moment to register
    await new Promise(resolve => setTimeout(resolve, 100));

    // Publish some events
    console.log('\n--- Publishing Events ---\n');

    // Example 1: Photo uploaded
    console.log('Publishing photo.uploaded event...');
    const result1 = await eventBus.publish('photo.uploaded', {
      photoId: 'photo-123',
      userId: 'user-456',
      filename: 'vacation.jpg',
      size: 1024000,
      mimeType: 'image/jpeg',
      uploadedAt: new Date().toISOString(),
    });
    console.log('Published:', result1.eventId);

    // Wait for event to be processed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Example 2: Photo processing started
    console.log('\nPublishing photo.processing.started event...');
    const result2 = await eventBus.publish('photo.processing.started', {
      photoId: 'photo-123',
      userId: 'user-456',
      jobId: 'job-789',
      startedAt: new Date().toISOString(),
      estimatedDuration: 30,
    });
    console.log('Published:', result2.eventId);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Example 3: Photo processing completed
    console.log('\nPublishing photo.processing.completed event...');
    const result3 = await eventBus.publish('photo.processing.completed', {
      photoId: 'photo-123',
      userId: 'user-456',
      jobId: 'job-789',
      completedAt: new Date().toISOString(),
      duration: 28,
      thumbnails: [
        {
          size: 'small',
          width: 150,
          height: 150,
          url: 'https://cdn.example.com/thumbnails/small.jpg',
          path: 'thumbnails/small/photo-123.jpg',
        },
        {
          size: 'medium',
          width: 300,
          height: 300,
          url: 'https://cdn.example.com/thumbnails/medium.jpg',
          path: 'thumbnails/medium/photo-123.jpg',
        },
      ],
      metadata: {
        width: 1920,
        height: 1080,
        format: 'jpeg',
        colorSpace: 'sRGB',
      },
      storageInfo: {
        bucket: 'photos',
        key: 'originals/photo-123.jpg',
        size: 1024000,
        contentType: 'image/jpeg',
      },
    });
    console.log('Published:', result3.eventId);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Example 4: User event
    console.log('\nPublishing user.registered event...');
    const result4 = await eventBus.publish('user.registered', {
      userId: 'user-789',
      email: 'newuser@example.com',
      registeredAt: new Date().toISOString(),
    });
    console.log('Published:', result4.eventId);

    await new Promise(resolve => setTimeout(resolve, 200));

    // Get statistics
    console.log('\n--- Event Bus Statistics ---\n');
    const stats = await eventBus.getStats();
    console.log(`Events published: ${stats.eventsPublished}`);
    console.log(`Events received: ${stats.eventsReceived}`);
    console.log(`Events delivered: ${stats.eventsDelivered}`);
    console.log(`Active subscriptions: ${stats.activeSubscriptions}`);
    console.log(`Uptime: ${Math.round(stats.uptime / 1000)}s`);

    // Health check
    console.log('\n--- Health Check ---\n');
    const health = await eventBus.healthCheck();
    console.log(`Overall status: ${health.status}`);
    console.log(`Uptime: ${Math.round(health.uptime / 1000)}s`);
    console.log('Checks:');
    for (const [name, check] of Object.entries(health.checks)) {
      console.log(`  - ${name}: ${check.status} ${check.message ? `(${check.message})` : ''}`);
    }

    // Wait a bit before cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean up
    console.log('\n--- Disconnecting ---\n');
    await eventBus.disconnect();
    console.log('Disconnected from Event Bus');
  }
}

// Run the example
main().catch(console.error);
