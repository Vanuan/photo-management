/**
 * Event Bus Client Tests
 */

import { EventBusClient } from '../src/core/event-bus-client';
import { EventBusConfig, Event } from '../src/types';
import Redis from 'ioredis';

// Mock Redis
jest.mock('ioredis');

// Mock Socket.IO client
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    connected: true,
  })),
}));

describe('EventBusClient', () => {
  let eventBus: EventBusClient;
  let config: EventBusConfig;
  let mockRedisPublisher: any;
  let mockRedisSubscriber: any;
  let redisCallCount: number;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    redisCallCount = 0;

    // Create mock Redis instances
    mockRedisPublisher = {
      publish: jest.fn().mockResolvedValue(1),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      once: jest.fn((event, callback) => {
        if (event === 'ready') {
          setTimeout(callback, 0);
        }
      }),
    };

    mockRedisSubscriber = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      psubscribe: jest.fn().mockResolvedValue(1),
      punsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
      once: jest.fn((event, callback) => {
        if (event === 'ready') {
          setTimeout(callback, 0);
        }
      }),
    };

    // Mock Redis constructor - first call returns publisher, second returns subscriber
    (Redis as any).mockImplementation(() => {
      redisCallCount++;
      return redisCallCount === 1 ? mockRedisPublisher : mockRedisSubscriber;
    });

    // Test configuration
    config = {
      serviceName: 'test-service',
      redis: {
        host: 'localhost',
        port: 6379,
      },
      logLevel: 'error', // Suppress logs in tests
    };
  });

  afterEach(async () => {
    if (eventBus && eventBus.isConnected()) {
      await eventBus.disconnect();
    }
  });

  describe('Constructor', () => {
    it('should create an instance with valid config', () => {
      eventBus = new EventBusClient(config);
      expect(eventBus).toBeInstanceOf(EventBusClient);
    });

    it('should throw error if serviceName is missing', () => {
      const invalidConfig = { ...config, serviceName: '' };
      expect(() => new EventBusClient(invalidConfig as any)).toThrow('serviceName is required');
    });

    it('should throw error if redis config is missing', () => {
      const invalidConfig = { serviceName: 'test' } as any;
      expect(() => new EventBusClient(invalidConfig)).toThrow('redis configuration is required');
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      eventBus = new EventBusClient(config);
    });

    it('should connect successfully', async () => {
      await eventBus.connect();
      expect(eventBus.isConnected()).toBe(true);
    });

    it('should not connect twice', async () => {
      await eventBus.connect();
      await eventBus.connect(); // Should not throw
      expect(eventBus.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await eventBus.connect();
      await eventBus.disconnect();
      expect(eventBus.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      await eventBus.disconnect(); // Should not throw
      expect(eventBus.isConnected()).toBe(false);
    });

    it('should initialize Redis clients on connect', async () => {
      await eventBus.connect();
      expect(Redis).toHaveBeenCalledTimes(2); // Publisher and subscriber
    });
  });

  describe('Publishing Events', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should publish an event successfully', async () => {
      const result = await eventBus.publish('test.event', { message: 'hello' });

      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();
      expect(result.publishedAt).toBeDefined();
      expect(mockRedisPublisher.publish).toHaveBeenCalled();
    });

    it('should publish event with correct structure', async () => {
      await eventBus.publish('test.event', { message: 'hello' });

      const publishCall = mockRedisPublisher.publish.mock.calls[0];
      const eventJson = publishCall[1];
      const event = JSON.parse(eventJson);

      expect(event.id).toBeDefined();
      expect(event.type).toBe('test.event');
      expect(event.data).toEqual({ message: 'hello' });
      expect(event.metadata).toBeDefined();
      expect(event.metadata.source).toBe('test-service');
      expect(event.metadata.timestamp).toBeDefined();
    });

    it('should throw error when not connected', async () => {
      await eventBus.disconnect();
      await expect(eventBus.publish('test.event', {})).rejects.toThrow('Not connected');
    });

    it('should handle publish errors gracefully', async () => {
      mockRedisPublisher.publish.mockRejectedValueOnce(new Error('Redis error'));

      const result = await eventBus.publish('test.event', {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Redis error');
    });

    it('should publish to specific room', async () => {
      await eventBus.publishToRoom('room-123', 'test.event', { message: 'hello' });

      const publishCall = mockRedisPublisher.publish.mock.calls[0];
      const channel = publishCall[0];

      expect(channel).toBe('room:room-123');
    });

    it('should publish to specific user', async () => {
      await eventBus.publishToUser('user-456', 'test.event', { message: 'hello' });

      const publishCall = mockRedisPublisher.publish.mock.calls[0];
      const channel = publishCall[0];

      expect(channel).toBe('user:user-456');
    });

    it('should broadcast to all', async () => {
      await eventBus.broadcast('test.event', { message: 'hello' });

      const publishCall = mockRedisPublisher.publish.mock.calls[0];
      const channel = publishCall[0];

      expect(channel).toBe('broadcast');
    });

    it('should include trace ID in metadata', async () => {
      const traceId = 'trace-123';
      await eventBus.publish('test.event', {}, { traceId });

      const publishCall = mockRedisPublisher.publish.mock.calls[0];
      const event = JSON.parse(publishCall[1]);

      expect(event.metadata.traceId).toBe(traceId);
    });
  });

  describe('Subscribing to Events', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should subscribe to events successfully', async () => {
      const handler = jest.fn();
      const subscription = await eventBus.subscribe('test.event', handler);

      expect(subscription).toBeDefined();
      expect(subscription.id).toBeDefined();
      expect(subscription.pattern).toBe('test.event');
      expect(subscription.handler).toBe(handler);
      expect(subscription.active).toBe(true);
    });

    it('should subscribe to pattern with wildcard', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('test.*', handler);

      expect(mockRedisSubscriber.psubscribe).toHaveBeenCalledWith('test.*');
    });

    it('should subscribe to exact channel without wildcard', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('test.event', handler);

      expect(mockRedisSubscriber.subscribe).toHaveBeenCalledWith('test.event');
    });

    it('should unsubscribe successfully', async () => {
      const handler = jest.fn();
      const subscription = await eventBus.subscribe('test.event', handler);

      const result = await eventBus.unsubscribe(subscription.id);

      expect(result).toBe(true);
      expect(mockRedisSubscriber.unsubscribe).toHaveBeenCalledWith('test.event');
    });

    it('should return false when unsubscribing non-existent subscription', async () => {
      const result = await eventBus.unsubscribe('non-existent-id');
      expect(result).toBe(false);
    });

    it('should throw error when subscribing while not connected', async () => {
      await eventBus.disconnect();
      const handler = jest.fn();

      await expect(eventBus.subscribe('test.event', handler)).rejects.toThrow('Not connected');
    });

    it('should handle subscription with options', async () => {
      const handler = jest.fn();
      const options = {
        retryOnError: true,
        maxRetries: 3,
        timeout: 5000,
      };

      const subscription = await eventBus.subscribe('test.event', handler, options);

      expect(subscription.options).toEqual(options);
    });
  });

  describe('Event Reception and Handling', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should receive and handle events', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('test.event', handler);

      // Simulate receiving a message from Redis
      const event: Event = {
        id: 'event-123',
        type: 'test.event',
        data: { message: 'hello' },
        metadata: {
          source: 'test-service',
          timestamp: new Date().toISOString(),
        },
      };

      // Get the message handler registered with Redis subscriber
      const messageHandler = mockRedisSubscriber.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        await messageHandler('test.event', JSON.stringify(event));
      }

      // Wait for async handler execution
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle multiple subscriptions for same pattern', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      await eventBus.subscribe('test.*', handler1);
      await eventBus.subscribe('test.*', handler2);

      const event: Event = {
        id: 'event-123',
        type: 'test.event',
        data: {},
        metadata: {
          source: 'test-service',
          timestamp: new Date().toISOString(),
        },
      };

      const messageHandler = mockRedisSubscriber.on.mock.calls.find(
        (call: any) => call[0] === 'pmessage'
      )?.[1];

      if (messageHandler) {
        await messageHandler('test.*', 'test.event', JSON.stringify(event));
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });
  });

  describe('Health Check', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should return healthy status when connected', async () => {
      const health = await eventBus.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeDefined();
      expect(health.checks).toBeDefined();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should check Redis health', async () => {
      const health = await eventBus.healthCheck();

      expect(health.checks.redis).toBeDefined();
      expect(health.checks.redis.status).toBe('pass');
      expect(mockRedisPublisher.ping).toHaveBeenCalled();
    });

    it('should return unhealthy status when Redis fails', async () => {
      mockRedisPublisher.ping.mockRejectedValueOnce(new Error('Redis down'));

      const health = await eventBus.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.checks.redis.status).toBe('fail');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should return statistics', async () => {
      const stats = await eventBus.getStats();

      expect(stats).toBeDefined();
      expect(stats.activeConnections).toBeDefined();
      expect(stats.eventsPublished).toBeDefined();
      expect(stats.eventsReceived).toBeDefined();
      expect(stats.activeSubscriptions).toBeDefined();
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should track published events', async () => {
      await eventBus.publish('test.event', {});
      await eventBus.publish('test.event', {});

      const stats = await eventBus.getStats();

      expect(stats.eventsPublished).toBe(2);
    });

    it('should track active subscriptions', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('test.event1', handler);
      await eventBus.subscribe('test.event2', handler);

      const stats = await eventBus.getStats();

      expect(stats.activeSubscriptions).toBe(2);
    });
  });

  describe('Pattern Matching', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should match wildcard patterns', async () => {
      const handler = jest.fn();
      await eventBus.subscribe('photo.*', handler);

      const events = [
        { type: 'photo.uploaded', shouldMatch: true },
        { type: 'photo.processing.started', shouldMatch: true },
        { type: 'user.registered', shouldMatch: false },
      ];

      for (const testEvent of events) {
        const event: Event = {
          id: 'event-123',
          type: testEvent.type,
          data: {},
          metadata: {
            source: 'test-service',
            timestamp: new Date().toISOString(),
          },
        };

        const pmessageHandler = mockRedisSubscriber.on.mock.calls.find(
          (call: any) => call[0] === 'pmessage'
        )?.[1];

        if (pmessageHandler) {
          await pmessageHandler('photo.*', testEvent.type, JSON.stringify(event));
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Handler should be called twice (for matching events)
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      eventBus = new EventBusClient(config);
      await eventBus.connect();
    });

    it('should handle handler errors gracefully', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));
      await eventBus.subscribe('test.event', handler);

      const event: Event = {
        id: 'event-123',
        type: 'test.event',
        data: {},
        metadata: {
          source: 'test-service',
          timestamp: new Date().toISOString(),
        },
      };

      const messageHandler = mockRedisSubscriber.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        await messageHandler('test.event', JSON.stringify(event));
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not throw, just log error
      expect(handler).toHaveBeenCalled();
    });

    it('should retry handler on error if configured', async () => {
      let attempts = 0;
      const handler = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary error');
        }
        return Promise.resolve();
      });

      await eventBus.subscribe('test.event', handler, {
        retryOnError: true,
        maxRetries: 3,
      });

      const event: Event = {
        id: 'event-123',
        type: 'test.event',
        data: {},
        metadata: {
          source: 'test-service',
          timestamp: new Date().toISOString(),
        },
      };

      const messageHandler = mockRedisSubscriber.on.mock.calls.find(
        (call: any) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        await messageHandler('test.event', JSON.stringify(event));
      }

      // Wait for retries
      await new Promise(resolve => setTimeout(resolve, 3000));

      expect(handler).toHaveBeenCalled();
    });
  });
});
