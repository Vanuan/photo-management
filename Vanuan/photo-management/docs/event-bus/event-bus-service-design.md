# Event Bus Service - Design Document

## Table of Contents
1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Core Components](#3-core-components)
4. [Event Types & Schemas](#4-event-types--schemas)
5. [WebSocket Management](#5-websocket-management)
6. [Event Routing & Filtering](#6-event-routing--filtering)
7. [Subscription Management](#7-subscription-management)
8. [Error Handling & Resilience](#8-error-handling--resilience)
9. [Security & Access Control](#9-security--access-control)
10. [Monitoring & Observability](#10-monitoring--observability)
11. [Performance & Scaling](#11-performance--scaling)
12. [Deployment & Configuration](#12-deployment--configuration)
13. [Implementation Guidelines](#13-implementation-guidelines)

## 1. Overview

### 1.1 Purpose
The Event Bus Service provides a centralized real-time event distribution system for the photo management platform. It enables seamless communication between backend services and frontend clients through WebSocket connections and Redis-based pub/sub messaging.

### 1.2 Key Responsibilities
- **Real-time Event Distribution**: Broadcast events to WebSocket clients and service subscribers
- **WebSocket Connection Management**: Handle client connections, rooms, and session management
- **Event Filtering & Routing**: Apply filters and route events based on configurable rules
- **Subscription Management**: Manage event subscriptions from backend services
- **Room Operations**: Handle client grouping and targeted broadcasting
- **Performance Monitoring**: Collect metrics on event throughput and connection health

### 1.3 Technology Stack
- **Node.js + TypeScript**: Primary runtime environment
- **Socket.IO**: WebSocket connection management
- **Redis**: Pub/sub messaging backbone
- **Docker**: Containerized deployment
- **Kubernetes**: Orchestration and scaling

## 2. Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Event Bus Service                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   WebSocket     │  │   Event Bus     │  │    Redis        │  │
│  │   Manager       │  │   Core          │  │   Publisher     │  │
│  │                 │  │                 │  │                 │  │
│  │ • Connection    │  │ • Event Routing │  │ • Channel Pub   │  │
│  │   Handling      │  │ • Filtering     │  │ • Event Dist    │  │
│  │ • Room Mgmt     │  │ • Metrics       │  │ • Persistence   │  │
│  │ • Auth          │  │ • Validation    │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                      │                      │        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Subscription   │  │   Filter        │  │    Metrics      │  │
│  │   Manager       │  │   Engine        │  │   Collector     │  │
│  │                 │  │                 │  │                 │  │
│  │ • Sub Tracking  │  │ • Rule Engine   │  │ • Performance   │  │
│  │ • Handler Mgmt  │  │ • Transform     │  │ • Health        │  │
│  │ • Lifecycle     │  │ • Routing       │  │ • Alerting      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Interactions

```typescript
interface EventBusService {
  // Publishing
  publishEvent(channel: string, event: Event): Promise<void>;
  publishEventBatch(events: ChannelEvent[]): Promise<void>;

  // Subscription Management
  subscribe(channel: string, handler: EventHandler): Promise<Subscription>;
  unsubscribe(subscriptionId: string): Promise<void>;

  // WebSocket Management
  registerClient(socketId: string, clientInfo: ClientInfo): void;
  unregisterClient(socketId: string): void;
  joinRoom(socketId: string, room: string): void;
  leaveRoom(socketId: string, room: string): void;

  // Room Operations
  broadcastToRoom(room: string, event: Event): Promise<void>;
  getRoomMembers(room: string): string[];
  getRoomCount(room: string): number;

  // Event Filtering
  addFilter(filterId: string, filter: EventFilter): void;
  removeFilter(filterId: string): void;

  // Monitoring
  getEventMetrics(timeRange?: TimeRange): Promise<EventMetrics>;
  getConnectionMetrics(): Promise<ConnectionMetrics>;
}
```

## 3. Core Components

### 3.1 Event Bus Core Implementation

```typescript
class EventBusServiceImpl implements EventBusService {
  private io: Server;
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private roomManager: RoomManager;
  private subscriptions: Map<string, Subscription> = new Map();
  private filters: Map<string, EventFilter> = new Map();
  private metrics: MetricsCollector;
  private logger: Logger;

  constructor(private config: EventBusConfig) {
    // Initialize Socket.IO server
    this.io = new Server(config.websocket.port, {
      cors: { origin: config.websocket.corsOrigins },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Initialize Redis clients
    this.redisPublisher = new Redis(config.redis);
    this.redisSubscriber = new Redis(config.redis);

    this.roomManager = new RoomManager(this.io);
    this.metrics = new MetricsCollector();
    this.logger = new Logger('EventBusService');

    this.setupRedisSubscriptions();
    this.setupWebSocketHandlers();
  }

  async publishEvent(channel: string, event: Event): Promise<void> {
    const startTime = Date.now();

    try {
      // Apply outbound filters
      const filteredEvent = this.applyFilters(event, 'outbound');
      if (!filteredEvent) {
        this.logger.debug(`Event filtered out`, { eventId: event.id, channel });
        return;
      }

      // Publish to Redis
      await this.redisPublisher.publish(channel, JSON.stringify(filteredEvent));

      // Update metrics
      this.metrics.incrementCounter('events_published_total', {
        channel,
        event_type: event.type
      });

      this.metrics.recordHistogram('event_publish_duration_ms', Date.now() - startTime);

      this.logger.debug(`Event published`, {
        eventId: event.id,
        channel,
        type: event.type,
        duration: Date.now() - startTime
      });

    } catch (error) {
      this.metrics.incrementCounter('event_publish_errors_total', {
        channel,
        error_type: error.constructor.name
      });

      this.logger.error(`Failed to publish event`, {
        eventId: event.id,
        channel,
        error: error.message
      });

      throw error;
    }
  }

  async subscribe(channel: string, handler: EventHandler): Promise<Subscription> {
    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      channel,
      handler,
      createdAt: new Date()
    };

    // Subscribe to Redis channel if not already subscribed
    if (!Array.from(this.subscriptions.values()).some(sub => sub.channel === channel)) {
      await this.redisSubscriber.subscribe(channel);
      this.logger.info(`Subscribed to Redis channel`, { channel });
    }

    this.subscriptions.set(subscriptionId, subscription);

    this.metrics.incrementCounter('subscriptions_created_total', { channel });

    return subscription;
  }

  private setupRedisSubscriptions(): void {
    this.redisSubscriber.on('message', async (channel, message) => {
      try {
        const event: Event = JSON.parse(message);

        // Apply inbound filters
        const filteredEvent = this.applyFilters(event, 'inbound');
        if (!filteredEvent) {
          return;
        }

        // Route to WebSocket clients
        await this.routeEventToWebSocket(channel, filteredEvent);

        // Route to subscriptions
        await this.routeEventToSubscriptions(channel, filteredEvent);

        // Update metrics
        this.metrics.incrementCounter('events_received_total', {
          channel,
          event_type: filteredEvent.type
        });

      } catch (error) {
        this.metrics.incrementCounter('event_processing_errors_total', {
          channel,
          error_type: error.constructor.name
        });

        this.logger.error(`Failed to process event`, {
          channel,
          error: error.message,
          message: message.substring(0, 100)
        });
      }
    });
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
```

### 3.2 Room Manager

```typescript
class RoomManager {
  private clients: Map<string, ClientInfo> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private clientRooms: Map<string, Set<string>> = new Map();

  constructor(private io: Server) {}

  registerClient(socketId: string, clientInfo: ClientInfo): void {
    this.clients.set(socketId, clientInfo);
    this.clientRooms.set(socketId, new Set());

    // Auto-join client-specific room
    this.joinRoom(socketId, `client:${clientInfo.clientId}`);

    // Auto-join session room if provided
    if (clientInfo.sessionId) {
      this.joinRoom(socketId, `session:${clientInfo.sessionId}`);
    }
  }

  unregisterClient(socketId: string): void {
    const clientRooms = this.clientRooms.get(socketId);
    if (clientRooms) {
      // Remove from all rooms
      clientRooms.forEach(room => {
        this.leaveRoom(socketId, room);
      });
    }

    this.clients.delete(socketId);
    this.clientRooms.delete(socketId);
  }

  joinRoom(socketId: string, room: string): void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }

    this.rooms.get(room)!.add(socketId);
    this.clientRooms.get(socketId)?.add(room);

    // Join Socket.IO room
    this.io.sockets.sockets.get(socketId)?.join(room);
  }

  leaveRoom(socketId: string, room: string): void {
    this.rooms.get(room)?.delete(socketId);
    this.clientRooms.get(socketId)?.delete(room);

    // Clean up empty rooms
    if (this.rooms.get(room)?.size === 0) {
      this.rooms.delete(room);
    }

    // Leave Socket.IO room
    this.io.sockets.sockets.get(socketId)?.leave(room);
  }

  getRoomMembers(room: string): string[] {
    return Array.from(this.rooms.get(room) || []);
  }

  getRoomCount(room: string): number {
    return this.rooms.get(room)?.size || 0;
  }
}
```

## 4. Event Types & Schemas

### 4.1 Core Event Interfaces

```typescript
interface Event {
  id: string;
  type: string;
  data: any;
  metadata: EventMetadata;
  timestamp: string;
}

interface EventMetadata {
  source: string;
  traceId?: string;
  clientId?: string;
  sessionId?: string;
  version: string;
}

interface ChannelEvent {
  channel: string;
  event: Event;
}
```

### 4.2 Photo Management Events

```typescript
type EventType = 
  | 'photo.uploaded'
  | 'photo.processing.started'
  | 'photo.processing.stage.completed'
  | 'photo.processing.completed'
  | 'photo.processing.failed'
  | 'photo.deleted'
  | 'batch.processing.completed';

interface PhotoUploadedEvent extends Event {
  type: 'photo.uploaded';
  data: {
    photoId: string;
    userId: string;
    filename: string;
    size: number;
    mimeType: string;
  };
}

interface PhotoProcessingStartedEvent extends Event {
  type: 'photo.processing.started';
  data: {
    photoId: string;
    jobId: string;
    stages: string[];
    estimatedDuration?: number;
  };
}

interface PhotoProcessingStageCompletedEvent extends Event {
  type: 'photo.processing.stage.completed';
  data: {
    photoId: string;
    jobId: string;
    stage: string;
    result: any;
    nextStage?: string;
    progress: number;
  };
}

interface PhotoProcessingCompletedEvent extends Event {
  type: 'photo.processing.completed';
  data: {
    photoId: string;
    jobId: string;
    results: {
      thumbnails: Array<{
        size: string;
        url: string;
        dimensions: { width: number; height: number };
      }>;
      metadata: {
        dimensions: { width: number; height: number };
        format: string;
        colorSpace: string;
        exif?: any;
      };
      optimization: {
        originalSize: number;
        optimizedSize: number;
        compressionRatio: number;
      };
    };
    duration: number;
  };
}

interface PhotoProcessingFailedEvent extends Event {
  type: 'photo.processing.failed';
  data: {
    photoId: string;
    jobId: string;
    stage: string;
    error: {
      code: string;
      message: string;
      details?: any;
    };
    retryable: boolean;
  };
}
```

## 5. WebSocket Management

### 5.1 WebSocket Handler Setup

```typescript
class WebSocketManager {
  constructor(
    private io: Server,
    private roomManager: RoomManager,
    private authService: AuthService,
    private metrics: MetricsCollector
  ) {
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.io.use(this.authMiddleware.bind(this));

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  private async authMiddleware(socket: Socket, next: Function): Promise<void> {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const authResult = await this.authService.validateToken(token);
      if (!authResult.valid) {
        return next(new Error('Invalid token'));
      }

      socket.data.user = authResult.user;
      socket.data.permissions = authResult.permissions;

      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  }

  private handleConnection(socket: Socket): void {
    this.metrics.incrementCounter('websocket_connections_total');
    this.metrics.setGauge('websocket_active_connections', this.io.engine.clientsCount);

    socket.on('identify', (clientInfo: ClientInfo) => {
      this.handleIdentify(socket, clientInfo);
    });

    socket.on('subscribe:photo', ({ photoId }) => {
      this.handlePhotoSubscription(socket, photoId);
    });

    socket.on('subscribe:user', ({ userId }) => {
      this.handleUserSubscription(socket, userId);
    });

    socket.on('unsubscribe:photo', ({ photoId }) => {
      this.handlePhotoUnsubscription(socket, photoId);
    });

    socket.on('heartbeat', () => {
      socket.emit('heartbeat', { timestamp: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socket, reason);
    });
  }

  private handleIdentify(socket: Socket, clientInfo: ClientInfo): void {
    this.roomManager.registerClient(socket.id, {
      ...clientInfo,
      userId: socket.data.user.id,
      permissions: socket.data.permissions
    });

    socket.emit('identified', {
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });
  }

  private handlePhotoSubscription(socket: Socket, photoId: string): void {
    // Check permissions
    if (!this.canAccessPhoto(socket.data.user, photoId)) {
      socket.emit('error', { message: 'Access denied' });
      return;
    }

    this.roomManager.joinRoom(socket.id, `photo:${photoId}`);
    socket.emit('subscribed', { room: `photo:${photoId}` });
  }

  private canAccessPhoto(user: any, photoId: string): boolean {
    // Implement permission checking logic
    return true;
  }
}
```

### 5.2 Client Connection Interface

```typescript
interface ClientInfo {
  clientId: string;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
  userId?: string;
  permissions?: string[];
}

interface WebSocketMetrics {
  activeConnections: number;
  totalConnections: number;
  messagesSent: number;
  messagesReceived: number;
  errorsCount: number;
  averageLatency: number;
}
```

## 6. Event Routing & Filtering

### 6.1 Event Routing Engine

```typescript
class EventRoutingEngine {
  private routingRules: Map<string, RoutingRule[]> = new Map();

  constructor() {
    this.setupDefaultRules();
  }

  private setupDefaultRules(): void {
    // Photo upload events
    this.addRoutingRule('photo:upload', {
      type: 'multi',
      rules: [
        {
          type: 'client',
          selector: 'metadata.clientId',
          eventName: 'upload.event'
        },
        {
          type: 'room',
          selector: 'metadata.sessionId',
          targetPrefix: 'session:',
          eventName: 'upload.event'
        }
      ]
    });

    // Processing events
    this.addRoutingRule('photo:processing', {
      type: 'multi',
      rules: [
        {
          type: 'room',
          selector: 'data.photoId',
          targetPrefix: 'photo:',
          eventName: 'processing.event'
        },
        {
          type: 'room',
          selector: 'data.userId',
          targetPrefix: 'user:',
          eventName: 'processing.event'
        }
      ]
    });

    // Completion events
    this.addRoutingRule('photo:completion', {
      type: 'multi',
      rules: [
        {
          type: 'room',
          selector: 'data.photoId',
          targetPrefix: 'photo:',
          eventName: 'completion.event'
        },
        {
          type: 'client',
          selector: 'metadata.clientId',
          eventName: 'completion.event'
        }
      ]
    });
  }

  getRoutingRules(channel: string, event: Event): RoutingTarget[] {
    const rules = this.routingRules.get(channel) || [];
    const targets: RoutingTarget[] = [];

    for (const rule of rules) {
      targets.push(...this.processRule(rule, event));
    }

    return targets;
  }

  private processRule(rule: RoutingRule, event: Event): RoutingTarget[] {
    if (rule.type === 'multi') {
      return rule.rules.flatMap(subRule => this.processRule(subRule, event));
    }

    const selectorValue = this.getEventFieldValue(event, rule.selector);
    if (!selectorValue) {
      return [];
    }

    const target = rule.targetPrefix ? `${rule.targetPrefix}${selectorValue}` : selectorValue;

    return [{
      type: rule.type as 'room' | 'client' | 'broadcast',
      target,
      eventName: rule.eventName || 'event'
    }];
  }

  private getEventFieldValue(event: Event, fieldPath: string): any {
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], event);
  }

  addRoutingRule(channel: string, rule: RoutingRule): void {
    if (!this.routingRules.has(channel)) {
      this.routingRules.set(channel, []);
    }
    this.routingRules.get(channel)!.push(rule);
  }
}

interface RoutingRule {
  type: 'room' | 'client' | 'broadcast' | 'multi';
  selector?: string;
  targetPrefix?: string;
  eventName?: string;
  rules?: RoutingRule[]; // For multi-type rules
}

interface RoutingTarget {
  type: 'room' | 'client' | 'broadcast';
  target: string;
  eventName: string;
}
```

### 6.2 Event Filter Engine

```typescript
class EventFilterEngine {
  private filters: Map<string, EventFilter> = new Map();

  applyFilters(event: Event, direction: 'inbound' | 'outbound'): Event | null {
    for (const filter of this.filters.values()) {
      if (filter.direction && filter.direction !== direction) {
        continue;
      }

      if (!this.matchesFilterConditions(event, filter.conditions)) {
        continue;
      }

      switch (filter.action.type) {
        case 'drop':
          return null;

        case 'transform':
          return this.transformEvent(event, filter.action.params);

        case 'route':
          // Custom routing handled elsewhere
          break;

        case 'throttle':
          if (!this.shouldAllowThrottled(event, filter.action.params)) {
            return null;
          }
          break;
      }
    }

    return event;
  }

  private matchesFilterConditions(event: Event, conditions: FilterCondition[]): boolean {
    return conditions.every(condition => {
      const fieldValue = this.getEventFieldValue(event, condition.field);

      switch (condition.operator) {
        case 'eq':
          return fieldValue === condition.value;
        case 'ne':
          return fieldValue !== condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(fieldValue);
        case 'contains':
          return typeof fieldValue === 'string' && fieldValue.includes(condition.value);
        case 'regex':
          return typeof fieldValue === 'string' && new RegExp(condition.value).test(fieldValue);
        case 'gt':
          return typeof fieldValue === 'number' && fieldValue > condition.value;
        case 'lt':
          return typeof fieldValue === 'number' && fieldValue < condition.value;
        default:
          return false;
      }
    });
  }

  private transformEvent(event: Event, transformParams: any): Event {
    const transformed = { ...event };

    if (transformParams.addFields) {
      Object.assign(transformed.data, transformParams.addFields);
    }

    if (transformParams.removeFields) {
      transformParams.removeFields.forEach((field: string) => {
        delete transformed.data[field];
      });
    }

    if (transformParams.modifyFields) {
      Object.entries(transformParams.modifyFields).forEach(([field, modification]: [string, any]) => {
        const currentValue = this.getEventFieldValue(transformed, field);
        if (modification.type === 'append') {
          this.setEventFieldValue(transformed, field, currentValue + modification.value);
        } else if (modification.type === 'replace') {
          this.setEventFieldValue(transformed, field, modification.value);
        }
      });
    }

    return transformed;
  }

  private shouldAllowThrottled(event: Event, throttleParams: ThrottleParams): boolean {
    const key = `throttle:${throttleParams.key || event.type}:${JSON.stringify(throttleParams.groupBy ? this.getEventFieldValue(event, throttleParams.groupBy) : 'global')}`;
    
    // Implementation would use Redis or in-memory store for throttling
    // This is a simplified example
    return true;
  }

  addFilter(filterId: string, filter: EventFilter): void {
    this.filters.set(filterId, filter);
  }

  removeFilter(filterId: string): void {
    this.filters.delete(filterId);
  }

  private getEventFieldValue(event: Event, fieldPath: string): any {
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], event);
  }

  private setEventFieldValue(event: Event, fieldPath: string, value: any): void {
    const keys = fieldPath.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((obj, key) => obj[key], event as any);
    target[lastKey] = value;
  }
}

interface EventFilter {
  type: 'include' | 'exclude';
  direction?: 'inbound' | 'outbound';
  conditions: FilterCondition[];
  action: FilterAction;
}

interface FilterCondition {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'contains' | 'regex' | 'gt' | 'lt';
  value: any;
}

interface FilterAction {
  type: 'drop' | 'transform' | 'route' | 'throttle';
  params?: any;
}

interface ThrottleParams {
  key?: string;
  groupBy?: string;
  limit: number;
  window: number; // seconds
}
```

## 7. Subscription Management

### 7.1 Subscription Manager

```typescript
class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  private channelSubscriptions: Map<string, Set<string>> = new Map();
  private metrics: MetricsCollector;

  constructor(private redisSubscriber: Redis, metrics: MetricsCollector) {
    this.metrics = metrics;
  }

  async subscribe(channel: string, handler: EventHandler, options?: SubscriptionOptions): Promise<Subscription> {
    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      channel,
      handler,
      options: options || {},
      createdAt: new Date(),
      lastMessageAt: null,
      messageCount: 0,
      errorCount: 0
    };

    // Add to tracking maps
    this.subscriptions.set(subscriptionId, subscription);
    
    if (!this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.set(channel, new Set());
      // Subscribe to Redis channel
      await this.redisSubscriber.subscribe(channel);
    }
    
    this.channelSubscriptions.get(channel)!.add(subscriptionId);

    this.metrics.incrementCounter('subscriptions_created_total', { channel });
    this.metrics.setGauge('active_subscriptions_total', this.subscriptions.size);

    return subscription;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    const channel = subscription.channel;
    
    // Remove from tracking
    this.subscriptions.delete(subscriptionId);
    this.channelSubscriptions.get(channel)?.delete(subscriptionId);

    // If no more subscriptions for this channel, unsubscribe from Redis
    if (this.channelSubscriptions.get(channel)?.size === 0) {
      this.channelSubscriptions.delete(channel);
      await this.redisSubscriber.unsubscribe(channel);
    }

    this.metrics.incrementCounter('subscriptions_removed_total', { channel });
    this.metrics.setGauge('active_subscriptions_total', this.subscriptions.size);
  }

  async handleChannelMessage(channel: string, event: Event): Promise<void> {
    const subscriptionIds = this.channelSubscriptions.get(channel) || new Set();
    const promises: Promise<void>[] = [];

    for (const subscriptionId of subscriptionIds) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) continue;

      promises.push(this.executeHandler(subscription, event));
    }

    await Promise.allSettled(promises);
  }

  private async executeHandler(subscription: Subscription, event: Event): Promise<void> {
    const startTime = Date.now();

    try {
      // Apply subscription filters
      if (subscription.options.filter && !this.passesFilter(event, subscription.options.filter)) {
        return;
      }

      // Execute handler
      await subscription.handler(event);

      // Update metrics
      subscription.messageCount++;
      subscription.lastMessageAt = new Date();

      this.metrics.incrementCounter('subscription_messages_processed_total', {
        channel: subscription.channel,
        subscription_id: subscription.id
      });

      this.metrics.recordHistogram('subscription_handler_duration_ms', Date.now() - startTime);

    } catch (error) {
      subscription.errorCount++;

      this.metrics.incrementCounter('subscription_handler_errors_total', {
        channel: subscription.channel,
        error_type: error.constructor.name
      });

      // Handle error based on subscription options
      if (subscription.options.onError) {
        try {
          await subscription.options.onError(error, event, subscription);
        } catch (onErrorError) {
          console.error('Error in subscription error handler:', onErrorError);
        }
      }

      // Auto-unsubscribe on too many errors
      if (subscription.options.maxErrors && subscription.errorCount >= subscription.options.maxErrors) {
        await this.unsubscribe(subscription.id);
      }
    }
  }

  private passesFilter(event: Event, filter: SubscriptionFilter): boolean {
    if (filter.eventTypes && !filter.eventTypes.includes(event.type)) {
      return false;
    }

    if (filter.conditions) {
      return filter.conditions.every(condition => {
        const fieldValue = this.getEventFieldValue(event, condition.field);
        return this.evaluateCondition(fieldValue, condition);
      });
    }

    return true;
  }

  private evaluateCondition(value: any, condition: FilterCondition): boolean {
    switch (condition.operator) {
      case 'eq': return value === condition.value;
      case 'ne': return value !== condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
      case 'contains': return typeof value === 'string' && value.includes(condition.value);
      case 'regex': return typeof value === 'string' && new RegExp(condition.value).test(value);
      case 'gt': return typeof value === 'number' && value > condition.value;
      case 'lt': return typeof value === 'number' && value < condition.value;
      default: return false;
    }
  }

  getSubscriptionStats(): SubscriptionStats {
    const stats: SubscriptionStats = {
      totalSubscriptions: this.subscriptions.size,
      channelCounts: new Map(),
      errorCounts: new Map(),
      oldestSubscription: null,
      averageMessageCount: 0
    };

    let totalMessages = 0;
    let oldestDate: Date | null = null;

    for (const subscription of this.subscriptions.values()) {
      // Channel counts
      const current = stats.channelCounts.get(subscription.channel) || 0;
      stats.channelCounts.set(subscription.channel, current + 1);

      // Error counts
      if (subscription.errorCount > 0) {
        const errorCount = stats.errorCounts.get(subscription.channel) || 0;
        stats.errorCounts.set(subscription.channel, errorCount + subscription.errorCount);
      }

      // Message counts
      totalMessages += subscription.messageCount;

      // Oldest subscription
      if (!oldestDate || subscription.createdAt < oldestDate) {
        oldestDate = subscription.createdAt;
        stats.oldestSubscription = subscription.id;
      }
    }

    stats.averageMessageCount = this.subscriptions.size > 0 ? totalMessages / this.subscriptions.size : 0;

    return stats;
  }

  private getEventFieldValue(event: Event, fieldPath: string): any {
    return fieldPath.split('.').reduce((obj, key) => obj?.[key], event);
  }

  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

interface Subscription {
  id: string;
  channel: string;
  handler: EventHandler;
  options: SubscriptionOptions;
  createdAt: Date;
  lastMessageAt: Date | null;
  messageCount: number;
  errorCount: number;
}

interface SubscriptionOptions {
  filter?: SubscriptionFilter;
  onError?: (error: Error, event: Event, subscription: Subscription) => Promise<void>;
  maxErrors?: number;
  autoRetry?: boolean;
  retryDelay?: number;
}

interface SubscriptionFilter {
  eventTypes?: string[];
  conditions?: FilterCondition[];
}

interface SubscriptionStats {
  totalSubscriptions: number;
  channelCounts: Map<string, number>;
  errorCounts: Map<string, number>;
  oldestSubscription: string | null;
  averageMessageCount: number;
}

type EventHandler = (event: Event) => Promise<void> | void;
```

## 8. Error Handling & Resilience

### 8.1 Error Recovery Manager

```typescript
class ErrorRecoveryManager {
  private retryQueues: Map<string, RetryQueue> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private deadLetterQueue: DeadLetterQueue;

  constructor(
    private config: ResilienceConfig,
    private metrics: MetricsCollector
  ) {
    this.deadLetterQueue = new DeadLetterQueue(config.deadLetter);
  }

  async handleEventError(
    channel: string,
    event: Event,
    error: Error,
    attempt: number = 1
  ): Promise<boolean> {
    const errorCategory = this.categorizeError(error);
    
    this.metrics.incrementCounter('event_errors_total', {
      channel,
      error_type: error.constructor.name,
      category: errorCategory
    });

    // Check circuit breaker
    const circuitBreaker = this.getCircuitBreaker(channel);
    if (!circuitBreaker.canExecute()) {
      await this.deadLetterQueue.add(channel, event, error, 'circuit_open');
      return false;
    }

    // Determine retry strategy
    const shouldRetry = this.shouldRetryError(error, attempt, errorCategory);
    
    if (shouldRetry) {
      const delay = this.calculateRetryDelay(attempt, errorCategory);
      await this.scheduleRetry(channel, event, attempt + 1, delay);
      return true;
    } else {
      await this.deadLetterQueue.add(channel, event, error, 'max_retries_exceeded');
      circuitBreaker.recordFailure();
      return false;
    }
  }

  private categorizeError(error: Error): ErrorCategory {
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.name === 'ConnectionError') return 'network';
    if (error.name === 'ValidationError') return 'validation';
    if (error.message.includes('rate limit')) return 'rate_limit';
    return 'unknown';
  }

  private shouldRetryError(error: Error, attempt: number, category: ErrorCategory): boolean {
    const maxAttempts = this.config.maxRetries[category] || this.config.maxRetries.default;
    
    if (attempt >= maxAttempts) {
      return false;
    }

    // Don't retry validation errors
    if (category === 'validation') {
      return false;
    }

    return true;
  }

  private calculateRetryDelay(attempt: number, category: ErrorCategory): number {
    const baseDelay = this.config.baseRetryDelay[category] || this.config.baseRetryDelay.default;
    const maxDelay = this.config.maxRetryDelay[category] || this.config.maxRetryDelay.default;
    
    // Exponential backoff with jitter
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private async scheduleRetry(channel: string, event: Event, attempt: number, delay: number): Promise<void> {
    if (!this.retryQueues.has(channel)) {
      this.retryQueues.set(channel, new RetryQueue(channel));
    }

    const retryQueue = this.retryQueues.get(channel)!;
    await retryQueue.schedule(event, attempt, delay);
  }

  private getCircuitBreaker(channel: string): CircuitBreaker {
    if (!this.circuitBreakers.has(channel)) {
      this.circuitBreakers.set(channel, new CircuitBreaker({
        failureThreshold: this.config.circuitBreaker.failureThreshold,
        resetTimeout: this.config.circuitBreaker.resetTimeout,
        monitoringWindow: this.config.circuitBreaker.monitoringWindow
      }));
    }

    return this.circuitBreakers.get(channel)!;
  }
}

class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private nextAttempt = 0;
  private stateChangeTime = Date.now();

  constructor(private config: CircuitBreakerConfig) {}

  canExecute(): boolean {
    const now = Date.now();

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        if (now >= this.nextAttempt) {
          this.state = 'half-open';
          this.stateChangeTime = now;
          return true;
        }
        return false;

      case 'half-open':
        return this.successes < 3; // Allow a few test requests

      default:
        return false;
    }
  }

  recordSuccess(): void {
    this.successes++;
    this.failures = 0;

    if (this.state === 'half-open' && this.successes >= 3) {
      this.state = 'closed';
      this.stateChangeTime = Date.now();
    }
  }

  recordFailure(): void {
    this.failures++;
    this.successes = 0;

    if (this.state === 'closed' && this.failures >= this.config.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.config.resetTimeout;
      this.stateChangeTime = Date.now();
    } else if (this.state === 'half-open') {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.config.resetTimeout;
      this.stateChangeTime = Date.now();
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}

type ErrorCategory = 'timeout' | 'network' | 'validation' | 'rate_limit' | 'unknown';
type CircuitBreakerState = 'closed' | 'open' | 'half-open';

interface ResilienceConfig {
  maxRetries: Record<ErrorCategory | 'default', number>;
  baseRetryDelay: Record<ErrorCategory | 'default', number>;
  maxRetryDelay: Record<ErrorCategory | 'default', number>;
  circuitBreaker: CircuitBreakerConfig;
  deadLetter: DeadLetterConfig;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringWindow: number;
}

interface DeadLetterConfig {
  enabled: boolean;
  retentionDays: number;
  maxSize: number;
}
```

### 8.2 Health Check System

```typescript
class EventBusHealthChecker {
  private healthChecks: Map<string, HealthCheck> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();

  constructor(
    private eventBus: EventBusService,
    private redis: Redis,
    private metrics: MetricsCollector
  ) {
    this.registerDefaultChecks();
  }

  private registerDefaultChecks(): void {
    this.healthChecks.set('redis-connection', {
      name: 'Redis Connection',
      timeout: 5000,
      interval: 30000,
      check: () => this.checkRedisConnection()
    });

    this.healthChecks.set('websocket-server', {
      name: 'WebSocket Server',
      timeout: 3000,
      interval: 15000,
      check: () => this.checkWebSocketServer()
    });

    this.healthChecks.set('subscription-health', {
      name: 'Subscription Health',
      timeout: 5000,
      interval: 60000,
      check: () => this.checkSubscriptionHealth()
    });

    this.healthChecks.set('memory-usage', {
      name: 'Memory Usage',
      timeout: 1000,
      interval: 30000,
      check: () => this.checkMemoryUsage()
    });
  }

  async runAllChecks(): Promise<OverallHealth> {
    const results: HealthCheckResult[] = [];
    const promises = Array.from(this.healthChecks.entries()).map(
      ([id, check]) => this.runSingleCheck(id, check)
    );

    const checkResults = await Promise.allSettled(promises);
    
    checkResults.forEach((result, index) => {
      const [id] = Array.from(this.healthChecks.entries())[index];
      
      if (result.status === 'fulfilled') {
        results.push(result.value);
        this.lastResults.set(id, result.value);
      } else {
        const errorResult: HealthCheckResult = {
          name: this.healthChecks.get(id)!.name,
          status: 'unhealthy',
          message: `Check failed: ${result.reason}`,
          duration: 0,
          timestamp: new Date()
        };
        results.push(errorResult);
        this.lastResults.set(id, errorResult);
      }
    });

    return this.determineOverallHealth(results);
  }

  private async runSingleCheck(id: string, check: HealthCheck): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const result = await Promise.race([
        check.check(),
        this.createTimeoutPromise(check.timeout)
      ]);

      const duration = Date.now() - startTime;
      
      this.metrics.recordHistogram('health_check_duration_ms', duration, { check_id: id });
      
      return {
        name: check.name,
        status: result.healthy ? 'healthy' : 'unhealthy',
        message: result.message,
        details: result.details,
        duration,
        timestamp: new Date()
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.metrics.incrementCounter('health_check_failures_total', { check_id: id });
      
      return {
        name: check.name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration,
        timestamp: new Date()
      };
    }
  }

  private async checkRedisConnection(): Promise<CheckResult> {
    try {
      const start = Date.now();
      await this.redis.ping();
      const latency = Date.now() - start;

      return {
        healthy: latency < 1000,
        message: latency < 1000 ? 'Redis connection healthy' : 'Redis connection slow',
        details: { latency }
      };
    } catch (error) {
      return {
        healthy: false,
        message: 'Redis connection failed',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  private async checkWebSocketServer(): Promise<CheckResult> {
    // Check if WebSocket server is running and accepting connections
    const connectionCount = this.eventBus.getConnectionMetrics?.().then(m => m.activeConnections) || 0;
    
    return {
      healthy: true,
      message: `WebSocket server running with ${connectionCount} active connections`,
      details: { activeConnections: connectionCount }
    };
  }

  private async checkSubscriptionHealth(): Promise<CheckResult> {
    // Check subscription error rates and performance
    const stats = await this.getSubscriptionStats();
    const errorRate = stats.totalErrors / Math.max(stats.totalMessages, 1);

    return {
      healthy: errorRate < 0.05, // Less than 5% error rate
      message: `Subscription error rate: ${(errorRate * 100).toFixed(2)}%`,
      details: stats
    };
  }

  private async checkMemoryUsage(): Promise<CheckResult> {
    const usage = process.memoryUsage();
    const usedMB = usage.heapUsed / 1024 / 1024;
    const totalMB = usage.heapTotal / 1024 / 1024;
    const utilization = usedMB / totalMB;

    return {
      healthy: utilization < 0.9,
      message: `Memory usage: ${usedMB.toFixed(0)}MB / ${totalMB.toFixed(0)}MB (${(utilization * 100).toFixed(1)}%)`,
      details: { usedMB, totalMB, utilization }
    };
  }

  private determineOverallHealth(results: HealthCheckResult[]): OverallHealth {
    const healthy = results.filter(r => r.status === 'healthy').length;
    const total = results.length;
    const unhealthy = total - healthy;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthy === 0) {
      status = 'healthy';
    } else if (unhealthy <= total * 0.3) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      message: `${healthy}/${total} checks passing`,
      checks: results,
      timestamp: new Date()
    };
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), timeout);
    });
  }

  private async getSubscriptionStats(): Promise<any> {
    // Implementation would gather subscription statistics
    return {
      totalMessages: 1000,
      totalErrors: 10,
      activeSubscriptions: 25
    };
  }
}

interface HealthCheck {
  name: string;
  timeout: number;
  interval: number;
  check: () => Promise<CheckResult>;
}

interface CheckResult {
  healthy: boolean;
  message: string;
  details?: any;
}

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'unhealthy';
  message: string;
  details?: any;
  duration: number;
  timestamp: Date;
}

interface OverallHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  checks: HealthCheckResult[];
  timestamp: Date;
}
```

## 9. Security & Access Control

### 9.1 Authentication & Authorization

```typescript
class EventBusSecurityManager {
  private tokenValidator: TokenValidator;
  private permissionManager: PermissionManager;
  private rateLimiter: RateLimiter;
  private auditLogger: AuditLogger;

  constructor(private config: SecurityConfig) {
    this.tokenValidator = new TokenValidator(config.jwt);
    this.permissionManager = new PermissionManager(config.permissions);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.auditLogger = new AuditLogger();
  }

  async authenticateClient(token: string, clientInfo: ClientInfo): Promise<AuthResult> {
    try {
      // Validate JWT token
      const tokenPayload = await this.tokenValidator.validate(token);
      
      // Check rate limits
      const rateLimitResult = await this.rateLimiter.checkLimit(tokenPayload.userId, 'connection');
      if (!rateLimitResult.allowed) {
        this.auditLogger.log('rate_limit_exceeded', {
          userId: tokenPayload.userId,
          clientInfo,
          limit: rateLimitResult.limit
        });

        return {
          success: false,
          error: 'Rate limit exceeded',
          details: rateLimitResult
        };
      }

      // Get user permissions
      const permissions = await this.permissionManager.getUserPermissions(tokenPayload.userId);

      this.auditLogger.log('client_authenticated', {
        userId: tokenPayload.userId,
        clientInfo,
        permissions: permissions.map(p => p.name)
      });

      return {
        success: true,
        user: {
          id: tokenPayload.userId,
          roles: tokenPayload.roles || [],
          permissions
        }
      };

    } catch (error) {
      this.auditLogger.log('authentication_failed', {
        clientInfo,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: 'Authentication failed'
      };
    }
  }

  async authorizeChannelAccess(user: AuthenticatedUser, channel: string, action: 'publish' | 'subscribe'): Promise<boolean> {
    const requiredPermission = `event_bus:${action}:${channel}`;
    
    // Check specific channel permission
    if (this.permissionManager.hasPermission(user, requiredPermission)) {
      return true;
    }

    // Check wildcard permissions
    const wildcardPermission = `event_bus:${action}:*`;
    if (this.permissionManager.hasPermission(user, wildcardPermission)) {
      return true;
    }

    // Check role-based access
    const channelConfig = this.config.channelAccess[channel];
    if (channelConfig && channelConfig[action]) {
      const allowedRoles = channelConfig[action];
      if (user.roles.some(role => allowedRoles.includes(role))) {
        return true;
      }
    }

    this.auditLogger.log('channel_access_denied', {
      userId: user.id,
      channel,
      action,
      requiredPermission
    });

    return false;
  }

  async validateEventData(event: Event, user: AuthenticatedUser): Promise<ValidationResult> {
    const validators = this.config.eventValidation[event.type] || [];
    
    for (const validator of validators) {
      const result = await this.runValidator(validator, event, user);
      if (!result.valid) {
        this.auditLogger.log('event_validation_failed', {
          userId: user.id,
          eventType: event.type,
          eventId: event.id,
          validator: validator.name,
          error: result.error
        });

        return result;
      }
    }

    return { valid: true };
  }

  private async runValidator(validator: EventValidator, event: Event, user: AuthenticatedUser): Promise<ValidationResult> {
    try {
      switch (validator.type) {
        case 'schema':
          return this.validateSchema(event, validator.schema);
        
        case 'permission':
          return this.validatePermission(event, user, validator.permission);
        
        case 'rate_limit':
          return await this.validateRateLimit(event, user, validator.config);
        
        case 'content':
          return this.validateContent(event, validator.rules);
        
        default:
          return { valid: false, error: `Unknown validator type: ${validator.type}` };
      }
    } catch (error) {
      return {
        valid: false,
        error: `Validator error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private validateSchema(event: Event, schema: any): ValidationResult {
    // JSON schema validation implementation
    // This would use a library like Ajv
    return { valid: true };
  }

  private validatePermission(event: Event, user: AuthenticatedUser, permission: string): ValidationResult {
    const hasPermission = this.permissionManager.hasPermission(user, permission);
    return {
      valid: hasPermission,
      error: hasPermission ? undefined : `Missing permission: ${permission}`
    };
  }

  private async validateRateLimit(event: Event, user: AuthenticatedUser, config: RateLimitConfig): Promise<ValidationResult> {
    const key = config.key.replace('{userId}', user.id).replace('{eventType}', event.type);
    const result = await this.rateLimiter.checkLimit(key, config.window, config.limit);

    return {
      valid: result.allowed,
      error: result.allowed ? undefined : `Rate limit exceeded: ${result.limit}/${config.window}s`
    };
  }

  private validateContent(event: Event, rules: ContentRule[]): ValidationResult {
    for (const rule of rules) {
      if (rule.type === 'no_script' && this.containsScript(event.data)) {
        return { valid: false, error: 'Event data contains script content' };
      }
      
      if (rule.type === 'max_size' && JSON.stringify(event.data).length > rule.value) {
        return { valid: false, error: `Event data exceeds maximum size: ${rule.value}` };
      }
    }

    return { valid: true };
  }

  private containsScript(data: any): boolean {
    const dataStr = JSON.stringify(data);
    const scriptRegex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
    return scriptRegex.test(dataStr);
  }
}

interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
  details?: any;
}

interface AuthenticatedUser {
  id: string;
  roles: string[];
  permissions: Permission[];
}

interface Permission {
  name: string;
  resource: string;
  action: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface EventValidator {
  name: string;
  type: 'schema' | 'permission' | 'rate_limit' | 'content';
  schema?: any;
  permission?: string;
  config?: RateLimitConfig;
  rules?: ContentRule[];
}

interface RateLimitConfig {
  key: string;
  window: number;
  limit: number;
}

interface ContentRule {
  type: 'no_script' | 'max_size' | 'allowed_fields';
  value?: any;
}

interface SecurityConfig {
  jwt: JWTConfig;
  permissions: PermissionConfig;
  rateLimit: RateLimitSettings;
  channelAccess: Record<string, ChannelAccessConfig>;
  eventValidation: Record<string, EventValidator[]>;
}

interface ChannelAccessConfig {
  publish?: string[];
  subscribe?: string[];
}
```

## 10. Monitoring & Observability

### 10.1 Metrics Collection

```typescript
class EventBusMetricsCollector {
  private prometheus: PrometheusRegistry;
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private gauges: Map<string, Gauge> = new Map();

  constructor() {
    this.prometheus = new PrometheusRegistry();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Event metrics
    this.counters.set('events_published_total', new Counter({
      name: 'eventbus_events_published_total',
      help: 'Total number of events published',
      labelNames: ['channel', 'event_type'],
      registers: [this.prometheus]
    }));

    this.counters.set('events_received_total', new Counter({
      name: 'eventbus_events_received_total',
      help: 'Total number of events received',
      labelNames: ['channel', 'event_type'],
      registers: [this.prometheus]
    }));

    this.histograms.set('event_publish_duration_ms', new Histogram({
      name: 'eventbus_event_publish_duration_milliseconds',
      help: 'Event publishing duration in milliseconds',
      labelNames: ['channel'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.prometheus]
    }));

    // WebSocket metrics
    this.gauges.set('websocket_active_connections', new Gauge({
      name: 'eventbus_websocket_active_connections',
      help: 'Number of active WebSocket connections',
      registers: [this.prometheus]
    }));

    this.counters.set('websocket_connections_total', new Counter({
      name: 'eventbus_websocket_connections_total',
      help: 'Total number of WebSocket connections established',
      registers: [this.prometheus]
    }));

    this.counters.set('websocket_disconnections_total', new Counter({
      name: 'eventbus_websocket_disconnections_total',
      help: 'Total number of WebSocket disconnections',
      labelNames: ['reason'],
      registers: [this.prometheus]
    }));

    // Subscription metrics
    this.gauges.set('active_subscriptions_total', new Gauge({
      name: 'eventbus_active_subscriptions_total',
      help: 'Number of active subscriptions',
      registers: [this.prometheus]
    }));

    this.histograms.set('subscription_handler_duration_ms', new Histogram({
      name: 'eventbus_subscription_handler_duration_milliseconds',
      help: 'Subscription handler execution duration',
      labelNames: ['channel'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000],
      registers: [this.prometheus]
    }));

    // Error metrics
    this.counters.set('event_errors_total', new Counter({
      name: 'eventbus_event_errors_total',
      help: 'Total number of event processing errors',
      labelNames: ['channel', 'error_type', 'category'],
      registers: [this.prometheus]
    }));

    // Room metrics
    this.gauges.set('active_rooms_total', new Gauge({
      name: 'eventbus_active_rooms_total',
      help: 'Number of active rooms',
      registers: [this.prometheus]
    }));

    this.histograms.set('room_broadcast_duration_ms', new Histogram({
      name: 'eventbus_room_broadcast_duration_milliseconds',
      help: 'Room broadcast duration in milliseconds',
      labelNames: ['room_type'],
      buckets: [1, 5, 10, 25, 50, 100, 250],
      registers: [this.prometheus]
    }));
  }

  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.inc(labels);
    }
  }

  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.observe(labels, value);
    }
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.set(labels, value);
    }
  }

  decrementGauge(name: string, labels: Record<string, string> = {}): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.dec(labels);
    }
  }

  async getMetricsSnapshot(): Promise<EventBusMetricsSnapshot> {
    return {
      events: {
        published: await this.getCounterValue('events_published_total'),
        received: await this.getCounterValue('events_received_total'),
        errors: await this.getCounterValue('event_errors_total')
      },
      websockets: {
        activeConnections: await this.getGaugeValue('websocket_active_connections'),
        totalConnections: await this.getCounterValue('websocket_connections_total'),
        totalDisconnections: await this.getCounterValue('websocket_disconnections_total')
      },
      subscriptions: {
        active: await this.getGaugeValue('active_subscriptions_total'),
        handlerErrors: await this.getCounterValue('subscription_handler_errors_total')
      },
      rooms: {
        active: await this.getGaugeValue('active_rooms_total')
      },
      timestamp: new Date()
    };
  }

  private async getCounterValue(name: string): Promise<number> {
    const counter = this.counters.get(name);
    return counter ? await counter.get() : 0;
  }

  private async getGaugeValue(name: string): Promise<number> {
    const gauge = this.gauges.get(name);
    return gauge ? await gauge.get() : 0;
  }

  getPrometheusMetrics(): string {
    return this.prometheus.metrics();
  }
}

interface EventBusMetricsSnapshot {
  events: {
    published: number;
    received: number;
    errors: number;
  };
  websockets: {
    activeConnections: number;
    totalConnections: number;
    totalDisconnections: number;
  };
  subscriptions: {
    active: number;
    handlerErrors: number;
  };
  rooms: {
    active: number;
  };
  timestamp: Date;
}
```

### 10.2 Distributed Tracing

```typescript
class EventBusTracing {
  private tracer: Tracer;

  constructor(private config: TracingConfig) {
    this.tracer = trace.getTracer('event-bus-service', '1.0.0');
  }

  async traceEventPublish<T>(
    channel: string,
    event: Event,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(`event-bus.publish.${channel}`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        'event.id': event.id,
        'event.type': event.type,
        'event.channel': channel,
        'event.source': event.metadata.source
      }
    });

    try {
      // Inject trace context into event metadata
      event.metadata.traceId = span.spanContext().traceId;
      
      const result = await operation();
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      span.end();
    }
  }

  async traceEventConsume<T>(
    channel: string,
    event: Event,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = this.tracer.startSpan(`event-bus.consume.${channel}`, {
      kind: SpanKind.CONSUMER,
      attributes: {
        'event.id': event.id,
        'event.type': event.type,
        'event.channel': channel,
        'event.trace_id': event.metadata.traceId
      }
    });

    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      span.end();
    }
  }
}
```

## 11. Performance & Scaling

### 11.1 Performance Optimization

```typescript
class EventBusPerformanceOptimizer {
  private metrics: EventBusMetricsCollector;
  private config: PerformanceConfig;

  constructor(metrics: EventBusMetricsCollector, config: PerformanceConfig) {
    this.metrics = metrics;
    this.config = config;
  }

  async analyzePerformance(): Promise<PerformanceAnalysis> {
    const metricsSnapshot = await this.metrics.getMetricsSnapshot();
    
    const analysis: PerformanceAnalysis = {
      eventThroughput: this.analyzeEventThroughput(metricsSnapshot),
      connectionPerformance: this.analyzeConnectionPerformance(metricsSnapshot),
      subscriptionPerformance: this.analyzeSubscriptionPerformance(metricsSnapshot),
      recommendations: []
    };

    // Generate recommendations based on analysis
    if (analysis.eventThroughput.averageLatency > this.config.thresholds.maxLatency) {
      analysis.recommendations.push({
        type: 'scaling',
        priority: 'high',
        description: 'High event latency detected. Consider scaling horizontally.',
        action: 'scale_out'
      });
    }

    if (analysis.connectionPerformance.errorRate > this.config.thresholds.maxErrorRate) {
      analysis.recommendations.push({
        type: 'reliability',
        priority: 'high',
        description: 'High connection error rate. Review connection handling.',
        action: 'investigate_errors'
      });
    }

    return analysis;
  }

  private analyzeEventThroughput(snapshot: EventBusMetricsSnapshot): ThroughputAnalysis {
    // Implementation would calculate throughput metrics
    return {
      eventsPerSecond: snapshot.events.published / 60, // Simplified
      averageLatency: 45, // Would be calculated from histogram data
      errorRate: snapshot.events.errors / snapshot.events.published
    };
  }

  private analyzeConnectionPerformance(snapshot: EventBusMetricsSnapshot): ConnectionAnalysis {
    return {
      activeConnections: snapshot.websockets.activeConnections,
      connectionRate: snapshot.websockets.totalConnections / 3600, // Per hour
      disconnectionRate: snapshot.websockets.totalDisconnections / 3600,
      errorRate: 0.02 // Would be calculated from actual error metrics
    };
  }

  private analyzeSubscriptionPerformance(snapshot: EventBusMetricsSnapshot): SubscriptionAnalysis {
    return {
      activeSubscriptions: snapshot.subscriptions.active,
      handlerErrorRate: snapshot.subscriptions.handlerErrors / snapshot.events.received,
      averageHandlerLatency: 25 // Would be calculated from histogram data
    };
  }
}

interface PerformanceAnalysis {
  eventThroughput: ThroughputAnalysis;
  connectionPerformance: ConnectionAnalysis;
  subscriptionPerformance: SubscriptionAnalysis;
  recommendations: PerformanceRecommendation[];
}

interface PerformanceRecommendation {
  type: 'scaling' | 'optimization' | 'reliability';
  priority: 'low' | 'medium' | 'high';
  description: string;
  action: string;
}

interface ThroughputAnalysis {
  eventsPerSecond: number;
  averageLatency: number;
  errorRate: number;
}

interface ConnectionAnalysis {
  activeConnections: number;
  connectionRate: number;
  disconnectionRate: number;
  errorRate: number;
}

interface SubscriptionAnalysis {
  activeSubscriptions: number;
  handlerErrorRate: number;
  averageHandlerLatency: number;
}
```

### 11.2 Auto-scaling Strategy

```typescript
class EventBusAutoScaler {
  private kubernetesClient: KubernetesClient;
  private metrics: EventBusMetricsCollector;
  private config: AutoScalingConfig;

  constructor(
    kubernetesClient: KubernetesClient,
    metrics: EventBusMetricsCollector,
    config: AutoScalingConfig
  ) {
    this.kubernetesClient = kubernetesClient;
    this.metrics = metrics;
    this.config = config;
  }

  async evaluateScaling(): Promise<ScalingDecision> {
    const currentMetrics = await this.metrics.getMetricsSnapshot();
    const currentReplicas = await this.getCurrentReplicas();

    const cpuUtilization = await this.getCPUUtilization();
    const memoryUtilization = await this.getMemoryUtilization();
    const connectionLoad = currentMetrics.websockets.activeConnections / currentReplicas;

    const scaleUpNeeded = (
      cpuUtilization > this.config.scaleUpThresholds.cpu ||
      memoryUtilization > this.config.scaleUpThresholds.memory ||
      connectionLoad > this.config.scaleUpThresholds.connectionsPerPod
    );

    const scaleDownPossible = (
      cpuUtilization < this.config.scaleDownThresholds.cpu &&
      memoryUtilization < this.config.scaleDownThresholds.memory &&
      connectionLoad < this.config.scaleDownThresholds.connectionsPerPod &&
      currentReplicas > this.config.minReplicas
    );

    if (scaleUpNeeded && currentReplicas < this.config.maxReplicas) {
      const targetReplicas = Math.min(currentReplicas + 1, this.config.maxReplicas);
      return {
        action: 'scale_up',
        currentReplicas,
        targetReplicas,
        reason: this.buildScalingReason(cpuUtilization, memoryUtilization, connectionLoad)
      };
    }

    if (scaleDownPossible) {
      const targetReplicas = Math.max(currentReplicas - 1, this.config.minReplicas);
      return {
        action: 'scale_down',
        currentReplicas,
        targetReplicas,
        reason: 'Low resource utilization detected'
      };
    }

    return {
      action: 'no_change',
      currentReplicas,
      targetReplicas: currentReplicas,
      reason: 'Metrics within acceptable ranges'
    };
  }

  async executeScaling(decision: ScalingDecision): Promise<void> {
    if (decision.action === 'no_change') {
      return;
    }

    await this.kubernetesClient.scaleDeployment(
      'event-bus-service',
      decision.targetReplicas
    );

    // Wait for scaling to complete
    await this.waitForScaling(decision.targetReplicas);
  }

  private buildScalingReason(cpu: number, memory: number, connections: number): string {
    const reasons = [];
    if (cpu > this.config.scaleUpThresholds.cpu) {
      reasons.push(`High CPU: ${cpu.toFixed(1)}%`);
    }
    if (memory > this.config.scaleUpThresholds.memory) {
      reasons.push(`High Memory: ${memory.toFixed(1)}%`);
    }
    if (connections > this.config.scaleUpThresholds.connectionsPerPod) {
      reasons.push(`High Connection Load: ${connections.toFixed(0)} per pod`);
    }
    return reasons.join(', ');
  }

  private async getCurrentReplicas(): Promise<number> {
    return await this.kubernetesClient.getDeploymentReplicas('event-bus-service');
  }

  private async getCPUUtilization(): Promise<number> {
    // Implementation would query actual CPU metrics
    return 65;
  }

  private async getMemoryUtilization(): Promise<number> {
    // Implementation would query actual memory metrics
    return 70;
  }

  private async waitForScaling(targetReplicas: number): Promise<void> {
    const maxWait = 300000; // 5 minutes
    const pollInterval = 10000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const currentReplicas = await this.getCurrentReplicas();
      if (currentReplicas === targetReplicas) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Scaling timeout: failed to reach ${targetReplicas} replicas`);
  }
}

interface ScalingDecision {
  action: 'scale_up' | 'scale_down' | 'no_change';
  currentReplicas: number;
  targetReplicas: number;
  reason: string;
}

interface AutoScalingConfig {
  minReplicas: number;
  maxReplicas: number;
  scaleUpThresholds: {
    cpu: number;
    memory: number;
    connectionsPerPod: number;
  };
  scaleDownThresholds: {
    cpu: number;
    memory: number;
    connectionsPerPod: number;
  };
}
```

## 12. Deployment & Configuration

### 12.1 Docker Configuration

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/event-bus/package*.json ./packages/event-bus/

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY packages/event-bus ./packages/event-bus
COPY shared ./shared

# Build the application
RUN npm run build

# Production image
FROM node:18-alpine AS runtime

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S eventbus && \
    adduser -S eventbus -u 1001

# Copy built application
COPY --from=builder /app/packages/event-bus/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Set ownership
RUN chown -R eventbus:eventbus /app

USER eventbus

EXPOSE 3003 3004

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3004/health || exit 1

CMD ["node", "dist/index.js"]
```

### 12.2 Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: event-bus-service
  labels:
    app: event-bus-service
    component: infrastructure
spec:
  replicas: 3
  selector:
    matchLabels:
      app: event-bus-service
  template:
    metadata:
      labels:
        app: event-bus-service
    spec:
      containers:
      - name: event-bus-service
        image: photo-management/event-bus-service:latest
        ports:
        - containerPort: 3003
          name: websocket
        - containerPort: 3004
          name: health
        env:
        - name: NODE_ENV
          value: production
        - name: REDIS_HOST
          value: redis-service
        - name: REDIS_PORT
          value: "6379"
        - name: WEBSOCKET_PORT
          value: "3003"
        - name: HEALTH_PORT
          value: "3004"
        - name: LOG_LEVEL
          value: info
        resources:
          requests:
            memory: 256Mi
            cpu: 200m
          limits:
            memory: 512Mi
            cpu: 500m
        livenessProbe:
          httpGet:
            path: /health
            port: 3004
          initialDelaySeconds: 30
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3004
          initialDelaySeconds: 10
          periodSeconds: 15
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
          readOnly: true
      volumes:
      - name: config-volume
        configMap:
          name: event-bus-config

---
apiVersion: v1
kind: Service
metadata:
  name: event-bus-service
spec:
  selector:
    app: event-bus-service
  ports:
  - name: websocket
    port: 3003
    targetPort: 3003
  - name: health
    port: 3004
    targetPort: 3004
  type: ClusterIP

---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: event-bus-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: event-bus-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 12.3 Configuration Schema

```typescript
interface EventBusConfig {
  server: {
    websocketPort: number;
    healthPort: number;
    metricsPort: number;
  };
  
  redis: {
    host: string;
    port: number;
    db: number;
    password?: string;
    keyPrefix: string;
  };
  
  websocket: {
    corsOrigins: string[];
    pingTimeout: number;
    pingInterval: number;
    transports: string[];
  };
  
  security: {
    jwt: {
      secret: string;
      expiresIn: string;
    };
    rateLimit: {
      enabled: boolean;
      windowMs: number;
      maxRequests: number;
    };
    channelAccess: Record<string, ChannelAccessConfig>;
  };
  
  performance: {
    maxEventSize: number;
    batchSize: number;
    flushInterval: number;
    connectionLimit: number;
  };
  
  resilience: {
    maxRetries: Record<string, number>;
    baseRetryDelay: Record<string, number>;
    maxRetryDelay: Record<string, number>;
    circuitBreaker: CircuitBreakerConfig;
  };
  
  monitoring: {
    metrics: {
      enabled: boolean;
      port: number;
      endpoint: string;
    };
    tracing: {
      enabled: boolean;
      serviceName: string;
      jaegerEndpoint?: string;
    };
    logging: {
      level: string;
      format: string;
    };
  };
}
```

## 13. Implementation Guidelines

### 13.1 Development Setup

```bash
# Clone repository
git clone <repository-url>
cd photo-management

# Install dependencies
npm install

# Start development environment
docker-compose up -d redis

# Start Event Bus Service in development mode
cd packages/event-bus
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### 13.2 Testing Strategy

```typescript
describe('Event Bus Service', () => {
  let eventBus: EventBusService;
  let redisClient: Redis;
  
  beforeEach(async () => {
    // Setup test Redis instance
    redisClient = new Redis({
      host: 'localhost',
      port: 6380, // Test Redis port
      db: 1
    });
    
    eventBus = new EventBusServiceImpl({
      redis: { host: 'localhost', port: 6380, db: 1 },
      websocket: { port: 3005, corsOrigins: ['*'] }
    });
    
    await eventBus.initialize();
  });
  
  afterEach(async () => {
    await eventBus.close();
    await redisClient.disconnect();
  });
  
  describe('Event Publishing', () => {
    it('should publish events to Redis', async () => {
      const event: Event = {
        id: 'test-event-1',
        type: 'photo.uploaded',
        data: { photoId: '123', userId: 'user1' },
        metadata: { source: 'test', version: '1.0' },
        timestamp: new Date().toISOString()
      };
      
      await eventBus.publishEvent('photo:upload', event);
      
      // Verify event was published
      expect(mockRedisPublish).toHaveBeenCalledWith(
        'photo:upload',
        JSON.stringify(event)
      );
    });
  });
  
  describe('Subscription Management', () => {
    it('should handle subscriptions correctly', async () => {
      let receivedEvent: Event | null = null;
      
      const subscription = await eventBus.subscribe(
        'photo:upload',
        (event) => {
          receivedEvent = event;
        }
      );
      
      // Publish an event
      const testEvent: Event = {
        id: 'test-event-2',
        type: 'photo.uploaded',
        data: { photoId: '124' },
        metadata: { source: 'test', version: '1.0' },
        timestamp: new Date().toISOString()
      };
      
      await eventBus.publishEvent('photo:upload', testEvent);
      
      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(receivedEvent).toEqual(testEvent);
    });
  });
  
  describe('WebSocket Integration', () => {
    it('should handle WebSocket connections', async () => {
      const client = io('http://localhost:3005');
      
      return new Promise((resolve) => {
        client.on('connect', () => {
          client.emit('identify', {
            clientId: 'test-client',
            sessionId: 'test-session'
          });
          
          client.on('identified', () => {
            resolve();
          });
        });
      });
    });
  });
});
```

### 13.3 Production Considerations

#### Load Balancing
- Use sticky sessions for WebSocket connections
- Implement Redis-based session sharing
- Consider using a WebSocket-aware load balancer

#### Monitoring
- Set up Prometheus metrics collection
- Configure alerting for high error rates
- Monitor connection and subscription counts
- Track event latency and throughput

#### Security
- Enable JWT token validation
- Configure rate limiting per user
- Implement proper CORS settings
- Use TLS for WebSocket connections in production

#### Performance
- Tune Redis connection pooling
- Configure appropriate batch sizes
- Monitor memory usage and garbage collection
- Use clustering for high-availability deployments

---

## Conclusion

The Event Bus Service provides a robust, scalable real-time event distribution system for the photo management platform. Key benefits include:

**Architecture Benefits:**
- Decoupled event-driven communication
- Horizontal scaling capabilities
- Comprehensive error handling and resilience
- Flexible routing and filtering system

**Operational Benefits:**
- Health monitoring and observability
- Auto-scaling based on load metrics
- Comprehensive security and access control
- Production-ready deployment configurations

**Developer Benefits:**
- Type-safe TypeScript interfaces
- Comprehensive testing framework
- Clear separation of concerns
- Extensible plugin architecture

The design supports both current requirements and future growth, providing a solid foundation for real-time communication across the entire photo management ecosystem
