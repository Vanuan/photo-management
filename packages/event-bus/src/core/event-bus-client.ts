/**
 * Event Bus Client - Core Implementation
 *
 * Client library for connecting to the Event Bus service
 * Used by backend services for real-time communication
 */

import { io, Socket } from 'socket.io-client';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  EventBusConfig,
  IEventBusService,
  Event,
  PublishOptions,
  PublishResult,
  Subscription,
  EventHandler,
  SubscriptionOptions,
  HealthCheckResult,
  EventBusStats,
  SocketEvents,
  EventMetadata,
  SubscriptionFilter,
  ErrorInfo,
} from '../types';
import { Logger } from '../utils/logger';
import { EventValidator } from '../utils/validator';

/**
 * Event Bus Client
 *
 * Provides a simple interface for services to:
 * - Publish events
 * - Subscribe to events
 * - Manage rooms
 * - Monitor health
 */
export class EventBusClient implements IEventBusService {
  private config: EventBusConfig;
  private socket: Socket | null = null;
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;
  private subscriptions: Map<string, Subscription> = new Map();
  private logger: Logger;
  private validator: EventValidator;
  private connected: boolean = false;

  private stats = {
    eventsPublished: 0,
    eventsReceived: 0,
    eventsDelivered: 0,
    eventsFailed: 0,
    connectTime: 0,
  };

  constructor(config: EventBusConfig) {
    this.config = config;
    this.logger = new Logger(config.logLevel || 'info', config.serviceName);
    this.validator = new EventValidator();

    // Validate required configuration
    if (!config.serviceName) {
      throw new Error('serviceName is required in EventBusConfig');
    }

    if (!config.redis) {
      throw new Error('redis configuration is required in EventBusConfig');
    }
  }

  /**
   * Connect to the Event Bus service
   */
  async connect(): Promise<void> {
    if (this.connected) {
      this.logger.warn('Already connected to Event Bus');
      return;
    }

    try {
      this.logger.info('Connecting to Event Bus service...');

      // Initialize Redis clients
      await this.initializeRedis();

      // Initialize Socket.IO client (if client config provided)
      if (this.config.client) {
        await this.initializeSocketIO();
      }

      this.connected = true;
      this.stats.connectTime = Date.now();
      this.logger.info('Successfully connected to Event Bus service');
    } catch (error) {
      this.logger.error('Failed to connect to Event Bus', error);
      throw error;
    }
  }

  /**
   * Initialize Redis clients for pub/sub
   */
  private async initializeRedis(): Promise<void> {
    const redisConfig = {
      ...this.config.redis,
      keyPrefix: this.config.redis.keyPrefix || 'eventbus:',
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.debug(`Redis reconnect attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
    };

    // Publisher client
    this.redisPublisher = new Redis(redisConfig);

    // Subscriber client
    this.redisSubscriber = new Redis(redisConfig);

    // Wait for Redis to be ready
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.redisPublisher!.once('ready', () => resolve());
        this.redisPublisher!.once('error', err => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        this.redisSubscriber!.once('ready', () => resolve());
        this.redisSubscriber!.once('error', err => reject(err));
      }),
    ]);

    // Set up Redis message handler
    this.redisSubscriber.on('message', (channel, message) => {
      this.handleRedisMessage(channel, message);
    });

    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      this.handleRedisMessage(channel, message, pattern);
    });

    this.logger.info('Redis clients initialized');
  }

  /**
   * Initialize Socket.IO client
   */
  private async initializeSocketIO(): Promise<void> {
    if (!this.config.client) {
      return;
    }

    const socketConfig = {
      auth: {
        token: this.config.client.authToken,
        serviceName: this.config.serviceName,
      },
      reconnection: this.config.client.reconnection !== false,
      reconnectionDelay: this.config.client.reconnectionDelay || 1000,
      reconnectionDelayMax: this.config.client.reconnectionDelayMax || 5000,
      reconnectionAttempts: this.config.client.reconnectionAttempts || Infinity,
      timeout: this.config.client.timeout || 20000,
      transports: this.config.websocket?.transports || ['websocket', 'polling'],
    };

    this.socket = io(this.config.client.url, socketConfig);

    // Set up Socket.IO event handlers
    this.setupSocketHandlers();

    // Wait for connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Socket.IO connection timeout'));
      }, socketConfig.timeout);

      this.socket!.once('connect', () => {
        clearTimeout(timeout);
        this.logger.info('Socket.IO connected');
        resolve();
      });

      this.socket!.once('connect_error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Set up Socket.IO event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      this.logger.info('Socket.IO connected');
    });

    this.socket.on('disconnect', reason => {
      this.logger.warn(`Socket.IO disconnected: ${reason}`);
      if (reason === 'io server disconnect') {
        // Server disconnected, reconnect manually
        this.socket?.connect();
      }
    });

    this.socket.on('reconnect_attempt', attempt => {
      this.logger.debug(`Socket.IO reconnect attempt ${attempt}`);
    });

    this.socket.on('reconnect', attempt => {
      this.logger.info(`Socket.IO reconnected after ${attempt} attempts`);
      this.resubscribeAll();
    });

    this.socket.on('error', error => {
      this.logger.error('Socket.IO error', error);
      this.stats.eventsFailed++;
    });

    // Handle incoming events
    this.socket.on(SocketEvents.EVENT, (event: Event) => {
      this.handleSocketEvent(event);
    });
  }

  /**
   * Publish an event
   */
  async publish(
    eventType: string,
    data: any,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    if (!this.connected) {
      throw new Error('Not connected to Event Bus');
    }

    try {
      // Create event
      const event: Event = {
        id: uuidv4(),
        type: eventType,
        data,
        metadata: this.createMetadata(options),
      };

      // Validate event
      this.validator.validateEvent(event);

      // Determine channel
      const channel = this.getChannelForEvent(eventType, options);

      // Publish to Redis
      await this.redisPublisher!.publish(channel, JSON.stringify(event));

      this.stats.eventsPublished++;
      this.logger.debug(`Published event: ${eventType} to channel: ${channel}`);

      return {
        success: true,
        eventId: event.id,
        publishedAt: event.metadata.timestamp,
      };
    } catch (error) {
      this.stats.eventsFailed++;
      this.logger.error('Failed to publish event', error);

      return {
        success: false,
        eventId: uuidv4(),
        publishedAt: new Date().toISOString(),
        error: this.formatError(error),
      };
    }
  }

  /**
   * Publish event to a specific room
   */
  async publishToRoom(
    room: string,
    eventType: string,
    data: any,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    return this.publish(eventType, data, {
      ...options,
      room,
    });
  }

  /**
   * Publish event to a specific user
   */
  async publishToUser(
    userId: string,
    eventType: string,
    data: any,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    return this.publish(eventType, data, {
      ...options,
      userId,
    });
  }

  /**
   * Broadcast event to all connected clients
   */
  async broadcast(
    eventType: string,
    data: any,
    options: PublishOptions = {}
  ): Promise<PublishResult> {
    return this.publish(eventType, data, {
      ...options,
      broadcast: true,
    });
  }

  /**
   * Subscribe to events matching a pattern
   */
  async subscribe(
    pattern: string,
    handler: EventHandler,
    options: SubscriptionOptions = {}
  ): Promise<Subscription> {
    if (!this.connected) {
      throw new Error('Not connected to Event Bus');
    }

    const subscription: Subscription = {
      id: uuidv4(),
      pattern,
      handler,
      options,
      createdAt: new Date(),
      active: true,
    };

    // Store subscription
    this.subscriptions.set(subscription.id, subscription);

    // Subscribe to Redis channel/pattern
    const isPattern = pattern.includes('*') || pattern.includes('?');
    if (isPattern) {
      await this.redisSubscriber!.psubscribe(pattern);
    } else {
      await this.redisSubscriber!.subscribe(pattern);
    }

    // If Socket.IO is available, subscribe there too
    if (this.socket?.connected) {
      this.socket.emit(SocketEvents.SUBSCRIBE, {
        pattern,
        filter: options.metadata?.filter,
        options,
      });
    }

    this.logger.debug(`Subscribed to pattern: ${pattern}`);
    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: string): Promise<boolean> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    subscription.active = false;
    this.subscriptions.delete(subscriptionId);

    // Unsubscribe from Redis
    const isPattern = subscription.pattern.includes('*') || subscription.pattern.includes('?');
    if (isPattern) {
      await this.redisSubscriber!.punsubscribe(subscription.pattern);
    } else {
      await this.redisSubscriber!.unsubscribe(subscription.pattern);
    }

    // Unsubscribe from Socket.IO
    if (this.socket?.connected) {
      this.socket.emit(SocketEvents.UNSUBSCRIBE, {
        subscriptionId,
      });
    }

    this.logger.debug(`Unsubscribed from: ${subscription.pattern}`);
    return true;
  }

  /**
   * Join a room
   */
  async joinRoom(room: string): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Socket.IO not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit(SocketEvents.JOIN_ROOM, { room }, (response: any) => {
        if (response.success) {
          this.logger.debug(`Joined room: ${room}`);
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to join room'));
        }
      });
    });
  }

  /**
   * Leave a room
   */
  async leaveRoom(room: string): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Socket.IO not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit(SocketEvents.LEAVE_ROOM, { room }, (response: any) => {
        if (response.success) {
          this.logger.debug(`Left room: ${room}`);
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to leave room'));
        }
      });
    });
  }

  /**
   * Get members of a room
   */
  async getRoomMembers(room: string): Promise<string[]> {
    if (!this.socket?.connected) {
      throw new Error('Socket.IO not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit('get_room_members', { room }, (response: any) => {
        if (response.success) {
          resolve(response.members || []);
        } else {
          reject(new Error(response.error || 'Failed to get room members'));
        }
      });
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const checks: Record<string, any> = {};

    // Redis health
    try {
      await this.redisPublisher!.ping();
      checks.redis = {
        status: 'pass',
        message: 'Redis connection healthy',
      };
    } catch (error) {
      checks.redis = {
        status: 'fail',
        message: 'Redis connection failed',
        details: { error: String(error) },
      };
    }

    // Socket.IO health
    if (this.socket) {
      checks.socketio = {
        status: this.socket.connected ? 'pass' : 'fail',
        message: this.socket.connected ? 'Socket.IO connected' : 'Socket.IO disconnected',
      };
    }

    // Determine overall status
    const allPassed = Object.values(checks).every((check: any) => check.status === 'pass');
    const someFailed = Object.values(checks).some((check: any) => check.status === 'fail');

    return {
      status: allPassed ? 'healthy' : someFailed ? 'unhealthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      uptime: this.stats.connectTime ? Date.now() - this.stats.connectTime : 0,
      version: '1.0.0',
    };
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<EventBusStats> {
    const uptime = this.stats.connectTime ? Date.now() - this.stats.connectTime : 0;

    return {
      activeConnections: this.connected ? 1 : 0,
      totalConnections: this.connected ? 1 : 0,
      eventsPublished: this.stats.eventsPublished,
      eventsReceived: this.stats.eventsReceived,
      eventsDelivered: this.stats.eventsDelivered,
      eventsFailed: this.stats.eventsFailed,
      activeSubscriptions: this.subscriptions.size,
      totalSubscriptions: this.subscriptions.size,
      activeRooms: 0,
      averageLatency: 0,
      messagesPerSecond: uptime > 0 ? this.stats.eventsPublished / (uptime / 1000) : 0,
      errorRate:
        this.stats.eventsPublished > 0 ? this.stats.eventsFailed / this.stats.eventsPublished : 0,
      uptime,
    };
  }

  /**
   * Disconnect from Event Bus
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.logger.info('Disconnecting from Event Bus...');

    // Unsubscribe from all
    for (const subscriptionId of this.subscriptions.keys()) {
      await this.unsubscribe(subscriptionId);
    }

    // Close Socket.IO
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    // Close Redis connections
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
      this.redisPublisher = null;
    }

    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
      this.redisSubscriber = null;
    }

    this.connected = false;
    this.logger.info('Disconnected from Event Bus');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Handle Redis message
   */
  private handleRedisMessage(channel: string, message: string, pattern?: string): void {
    try {
      const event: Event = JSON.parse(message);
      this.stats.eventsReceived++;

      // Find matching subscriptions
      for (const subscription of this.subscriptions.values()) {
        if (!subscription.active) continue;

        const matches = pattern
          ? this.patternMatches(subscription.pattern, channel)
          : subscription.pattern === channel;

        if (matches) {
          this.executeHandler(subscription, event);
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle Redis message', error);
      this.stats.eventsFailed++;
    }
  }

  /**
   * Handle Socket.IO event
   */
  private handleSocketEvent(event: Event): void {
    this.stats.eventsReceived++;

    // Find matching subscriptions
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;

      if (this.eventMatchesPattern(event.type, subscription.pattern)) {
        this.executeHandler(subscription, event);
      }
    }
  }

  /**
   * Execute subscription handler
   */
  private async executeHandler(subscription: Subscription, event: Event): Promise<void> {
    try {
      // Apply filter if present
      if (subscription.filter && !this.passesFilter(event, subscription.filter)) {
        return;
      }

      // Execute handler with timeout
      const timeout = subscription.options?.timeout || 30000;
      await this.withTimeout(Promise.resolve(subscription.handler(event)), timeout);

      this.stats.eventsDelivered++;
    } catch (error) {
      this.logger.error(`Handler error for subscription ${subscription.id}`, error);
      this.stats.eventsFailed++;

      // Retry if configured
      if (subscription.options?.retryOnError) {
        this.retryHandler(subscription, event);
      }
    }
  }

  /**
   * Retry handler execution
   */
  private async retryHandler(subscription: Subscription, event: Event): Promise<void> {
    const maxRetries = subscription.options?.maxRetries || 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        await subscription.handler(event);
        this.logger.debug(`Handler retry succeeded for subscription ${subscription.id}`);
        this.stats.eventsDelivered++;
        return;
      } catch (error) {
        this.logger.error(`Handler retry ${retryCount} failed`, error);
      }
    }

    this.logger.error(`Handler failed after ${maxRetries} retries`);
  }

  /**
   * Check if event passes filter
   */
  private passesFilter(event: Event, filter: SubscriptionFilter): boolean {
    const { conditions, operator = 'AND' } = filter;

    const results = conditions.map(condition => {
      const fieldValue = this.getFieldValue(event, condition.field);
      return this.evaluateCondition(fieldValue, condition.operator, condition.value);
    });

    return operator === 'AND' ? results.every(r => r) : results.some(r => r);
  }

  /**
   * Evaluate filter condition
   */
  private evaluateCondition(fieldValue: any, operator: string, conditionValue: any): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === conditionValue;
      case 'notEquals':
        return fieldValue !== conditionValue;
      case 'contains':
        return String(fieldValue).includes(String(conditionValue));
      case 'notContains':
        return !String(fieldValue).includes(String(conditionValue));
      case 'greaterThan':
        return fieldValue > conditionValue;
      case 'lessThan':
        return fieldValue < conditionValue;
      case 'in':
        return Array.isArray(conditionValue) && conditionValue.includes(fieldValue);
      case 'notIn':
        return Array.isArray(conditionValue) && !conditionValue.includes(fieldValue);
      default:
        return false;
    }
  }

  /**
   * Get field value from event
   */
  private getFieldValue(event: Event, field: string): any {
    const parts = field.split('.');
    let value: any = event;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Create event metadata
   */
  private createMetadata(options: PublishOptions): EventMetadata {
    return {
      source: this.config.serviceName,
      timestamp: new Date().toISOString(),
      traceId: options.traceId || uuidv4(),
      correlationId: options.correlationId,
      userId: options.userId,
      version: '1.0.0',
    };
  }

  /**
   * Get channel for event
   */
  private getChannelForEvent(eventType: string, options: PublishOptions): string {
    if (options.room) {
      return `room:${options.room}`;
    }
    if (options.userId) {
      return `user:${options.userId}`;
    }
    if (options.broadcast) {
      return 'broadcast';
    }
    return eventType;
  }

  /**
   * Check if pattern matches channel
   */
  private patternMatches(pattern: string, channel: string): boolean {
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(channel);
  }

  /**
   * Check if event type matches pattern
   */
  private eventMatchesPattern(eventType: string, pattern: string): boolean {
    return this.patternMatches(pattern, eventType);
  }

  /**
   * Resubscribe to all active subscriptions
   */
  private async resubscribeAll(): Promise<void> {
    this.logger.info('Resubscribing to all active subscriptions...');

    for (const subscription of this.subscriptions.values()) {
      if (subscription.active && this.socket?.connected) {
        this.socket.emit(SocketEvents.SUBSCRIBE, {
          pattern: subscription.pattern,
          filter: subscription.filter,
          options: subscription.options,
        });
      }
    }
  }

  /**
   * Execute promise with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Handler timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Format error for API response
   */
  private formatError(error: any): ErrorInfo {
    return {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'An error occurred',
      details: error.details || {},
      stack: error.stack,
    };
  }
}
