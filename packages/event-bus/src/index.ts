/**
 * Event Bus Service - Main Entry Point
 *
 * @module @shared-infra/event-bus
 *
 * Provides real-time communication and event distribution for the photo management system
 *
 * @example
 * ```typescript
 * import { EventBusClient, EventBusConfig } from '@shared-infra/event-bus';
 *
 * const config: EventBusConfig = {
 *   serviceName: 'photo-api-service',
 *   redis: {
 *     host: 'localhost',
 *     port: 6379,
 *   },
 *   client: {
 *     url: 'http://localhost:3003',
 *     authToken: 'your-token',
 *   },
 * };
 *
 * const eventBus = new EventBusClient(config);
 * await eventBus.connect();
 *
 * // Publish events
 * await eventBus.publish('photo.uploaded', {
 *   photoId: '123',
 *   userId: 'user-456',
 *   filename: 'vacation.jpg',
 * });
 *
 * // Subscribe to events
 * await eventBus.subscribe('photo.*', async (event) => {
 *   console.log('Photo event received:', event);
 * });
 * ```
 */

// ============================================================================
// Internal Imports (for use in factory functions)
// ============================================================================

import { EventBusClient } from './core/event-bus-client';
import type { EventBusConfig } from './types';

// ============================================================================
// Core Classes
// ============================================================================

export { EventBusClient } from './core/event-bus-client';

// ============================================================================
// Types and Interfaces
// ============================================================================

export type {
  // Core event types
  Event,
  EventMetadata,
  ChannelEvent,
  EventType,

  // Photo management events
  PhotoUploadedEvent,
  PhotoUploadedData,
  PhotoProcessingStartedEvent,
  PhotoProcessingStartedData,
  PhotoProcessingProgressEvent,
  PhotoProcessingProgressData,
  PhotoProcessingStageCompletedEvent,
  PhotoProcessingStageData,
  PhotoProcessingCompletedEvent,
  PhotoProcessingCompletedData,
  PhotoProcessingFailedEvent,
  PhotoProcessingFailedData,
  ThumbnailInfo,
  PhotoMetadata,
  StorageInfo,
  ErrorInfo,

  // Configuration types
  EventBusConfig,
  ServerConfig,
  ClientConfig,
  RedisConfig,
  WebSocketConfig,
  CorsConfig,
  SecurityConfig,
  RateLimitConfig,
  AuthenticatedUser,
  PerformanceConfig,
  MonitoringConfig,

  // Subscription types
  Subscription,
  EventHandler,
  SubscriptionOptions,
  SubscriptionFilter,
  FilterCondition,
  SubscriptionStats,

  // Publishing types
  PublishOptions,
  PublishResult,

  // Room management
  RoomInfo,
  ClientInfo,

  // Health and monitoring
  HealthCheckResult,
  CheckResult,
  EventBusStats,
  MemoryUsage,
  MetricsSnapshot,
  ConnectionMetrics,
  EventMetrics,
  SubscriptionMetrics,
  PerformanceMetrics,
  ErrorMetrics,

  // Routing and filtering
  RoutingRule,
  RoutingTarget,
  EventTransform,
  EventFilter,
  FilterAction,
  ThrottleParams,

  // Error handling
  ErrorCategory,
  RetryConfig,
  CircuitBreakerState,
  CircuitBreakerConfig,

  // Service interfaces
  IEventBusService,
  IEventBusServer,

  // WebSocket types
  SocketMessage,
  IdentifyMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  JoinRoomMessage,
  LeaveRoomMessage,

  // Token validator
  TokenValidator,
} from './types';

// ============================================================================
// Constants
// ============================================================================

export { SocketEvents } from './types';

// ============================================================================
// Utilities
// ============================================================================

export { Logger, LogLevel } from './utils/logger';
export { EventValidator, ValidationError } from './utils/validator';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an Event Bus client with configuration
 *
 * @param config - Event Bus configuration
 * @returns Configured Event Bus client instance
 *
 * @example
 * ```typescript
 * const eventBus = createEventBusClient({
 *   serviceName: 'my-service',
 *   redis: {
 *     host: 'localhost',
 *     port: 6379,
 *   },
 * });
 *
 * await eventBus.connect();
 * ```
 */
export function createEventBusClient(config: EventBusConfig): EventBusClient {
  return new EventBusClient(config);
}

// ============================================================================
// Default Export
// ============================================================================

export { EventBusClient as default } from './core/event-bus-client';
