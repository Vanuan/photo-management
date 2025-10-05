/**
 * Event Bus Service - Type Definitions
 *
 * Core types for the Event Bus real-time communication library
 */

// ============================================================================
// Core Event Interfaces
// ============================================================================

/**
 * Base event interface for all events in the system
 */
export interface Event<T = any> {
  id: string;
  type: EventType | string;
  data: T;
  metadata: EventMetadata;
}

/**
 * Metadata attached to every event
 */
export interface EventMetadata {
  source: string;
  timestamp: string;
  traceId?: string;
  userId?: string;
  correlationId?: string;
  version?: string;
}

/**
 * Channel-specific event wrapper
 */
export interface ChannelEvent extends Event {
  channel: string;
}

// ============================================================================
// Event Types for Photo Management
// ============================================================================

/**
 * All event types in the photo management system
 */
export type EventType =
  | 'photo.uploaded'
  | 'photo.processing.started'
  | 'photo.processing.progress'
  | 'photo.processing.stage.completed'
  | 'photo.processing.completed'
  | 'photo.processing.failed'
  | 'batch.processing.started'
  | 'batch.processing.completed'
  | 'batch.processing.failed'
  | 'user.registered'
  | 'user.updated'
  | 'system.health.update'
  | 'system.maintenance'
  | 'notification.new';

/**
 * Photo uploaded event data
 */
export interface PhotoUploadedEvent extends Event<PhotoUploadedData> {
  type: 'photo.uploaded';
}

export interface PhotoUploadedData {
  photoId: string;
  userId: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

/**
 * Photo processing started event
 */
export interface PhotoProcessingStartedEvent extends Event<PhotoProcessingStartedData> {
  type: 'photo.processing.started';
}

export interface PhotoProcessingStartedData {
  photoId: string;
  userId: string;
  jobId: string;
  startedAt: string;
  estimatedDuration?: number;
}

/**
 * Photo processing progress event
 */
export interface PhotoProcessingProgressEvent extends Event<PhotoProcessingProgressData> {
  type: 'photo.processing.progress';
}

export interface PhotoProcessingProgressData {
  photoId: string;
  userId: string;
  jobId: string;
  progress: number;
  stage: string;
  currentStep?: string;
  estimatedCompletion?: string;
}

/**
 * Photo processing stage completed event
 */
export interface PhotoProcessingStageCompletedEvent extends Event<PhotoProcessingStageData> {
  type: 'photo.processing.stage.completed';
}

export interface PhotoProcessingStageData {
  photoId: string;
  userId: string;
  jobId: string;
  stage: string;
  completedAt: string;
  duration: number;
  nextStage?: string;
}

/**
 * Photo processing completed event
 */
export interface PhotoProcessingCompletedEvent extends Event<PhotoProcessingCompletedData> {
  type: 'photo.processing.completed';
}

export interface PhotoProcessingCompletedData {
  photoId: string;
  userId: string;
  jobId: string;
  completedAt: string;
  duration: number;
  thumbnails: ThumbnailInfo[];
  metadata: PhotoMetadata;
  storageInfo: StorageInfo;
}

export interface ThumbnailInfo {
  size: string;
  width: number;
  height: number;
  url: string;
  path: string;
}

export interface PhotoMetadata {
  width: number;
  height: number;
  format: string;
  colorSpace?: string;
  hasAlpha?: boolean;
  exif?: Record<string, any>;
}

export interface StorageInfo {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

/**
 * Photo processing failed event
 */
export interface PhotoProcessingFailedEvent extends Event<PhotoProcessingFailedData> {
  type: 'photo.processing.failed';
}

export interface PhotoProcessingFailedData {
  photoId: string;
  userId: string;
  jobId: string;
  failedAt: string;
  error: ErrorInfo;
  retryable: boolean;
  retryCount?: number;
}

export interface ErrorInfo {
  code: string;
  message: string;
  details?: Record<string, any>;
  stack?: string;
}

// ============================================================================
// Event Bus Configuration
// ============================================================================

/**
 * Complete event bus configuration
 */
export interface EventBusConfig {
  // Service identification
  serviceName: string;
  serviceVersion?: string;

  // Server configuration (for server mode)
  server?: ServerConfig;

  // Client configuration (for client mode)
  client?: ClientConfig;

  // Redis configuration
  redis: RedisConfig;

  // WebSocket configuration
  websocket?: WebSocketConfig;

  // Security settings
  security?: SecurityConfig;

  // Performance settings
  performance?: PerformanceConfig;

  // Monitoring settings
  monitoring?: MonitoringConfig;

  // Logging
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Server-specific configuration
 */
export interface ServerConfig {
  port: number;
  host?: string;
  cors?: CorsConfig;
  path?: string;
}

/**
 * Client-specific configuration
 */
export interface ClientConfig {
  url: string;
  authToken?: string;
  reconnection?: boolean;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  reconnectionAttempts?: number;
  timeout?: number;
}

/**
 * Redis configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  retryDelayOnFailover?: number;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  transports?: ('websocket' | 'polling')[];
  pingTimeout?: number;
  pingInterval?: number;
  maxHttpBufferSize?: number;
  connectTimeout?: number;
  serveClient?: boolean;
}

/**
 * CORS configuration
 */
export interface CorsConfig {
  origin: string | string[] | boolean;
  credentials?: boolean;
  methods?: string[];
  allowedHeaders?: string[];
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  enableAuth?: boolean;
  tokenValidator?: TokenValidator;
  rateLimiting?: RateLimitConfig;
  allowedOrigins?: string[];
}

export type TokenValidator = (token: string) => Promise<AuthenticatedUser | null>;

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (socket: any) => string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  batchSize?: number;
  batchInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  enableCompression?: boolean;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  enableMetrics?: boolean;
  enableTracing?: boolean;
  metricsPort?: number;
  healthCheckInterval?: number;
}

// ============================================================================
// Subscription Management
// ============================================================================

/**
 * Event subscription
 */
export interface Subscription {
  id: string;
  pattern: string;
  handler: EventHandler;
  filter?: SubscriptionFilter;
  options?: SubscriptionOptions;
  createdAt: Date;
  active: boolean;
}

/**
 * Event handler function type
 */
export type EventHandler<T = any> = (event: Event<T>) => Promise<void> | void;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  priority?: number;
  retryOnError?: boolean;
  maxRetries?: number;
  timeout?: number;
  metadata?: Record<string, any>;
}

/**
 * Filter for subscriptions
 */
export interface SubscriptionFilter {
  conditions: FilterCondition[];
  operator?: 'AND' | 'OR';
}

export interface FilterCondition {
  field: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'greaterThan' | 'lessThan' | 'in' | 'notIn';
  value: any;
}

/**
 * Subscription statistics
 */
export interface SubscriptionStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  eventsByType: Record<string, number>;
  errorRate: number;
  averageProcessingTime: number;
}

// ============================================================================
// Event Publishing
// ============================================================================

/**
 * Options for publishing events
 */
export interface PublishOptions {
  traceId?: string;
  correlationId?: string;
  priority?: number;
  ttl?: number;
  persistent?: boolean;
  room?: string;
  userId?: string;
  broadcast?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Result of publishing an event
 */
export interface PublishResult {
  success: boolean;
  eventId: string;
  publishedAt: string;
  deliveredTo?: number;
  error?: ErrorInfo;
}

// ============================================================================
// Room Management
// ============================================================================

/**
 * Room information
 */
export interface RoomInfo {
  name: string;
  memberCount: number;
  createdAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Client information
 */
export interface ClientInfo {
  id: string;
  userId?: string;
  rooms: string[];
  connectedAt: Date;
  lastActivity: Date;
  metadata?: Record<string, any>;
}

// ============================================================================
// Health Check & Monitoring
// ============================================================================

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, CheckResult>;
  uptime: number;
  version?: string;
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration?: number;
  details?: Record<string, any>;
}

/**
 * Event bus statistics
 */
export interface EventBusStats {
  // Connection stats
  activeConnections: number;
  totalConnections: number;

  // Event stats
  eventsPublished: number;
  eventsReceived: number;
  eventsDelivered: number;
  eventsFailed: number;

  // Subscription stats
  activeSubscriptions: number;
  totalSubscriptions: number;

  // Room stats
  activeRooms: number;

  // Performance stats
  averageLatency: number;
  messagesPerSecond: number;

  // Error stats
  errorRate: number;
  lastError?: ErrorInfo;

  // Memory and resources
  memoryUsage?: MemoryUsage;
  uptime: number;
}

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

/**
 * Metrics snapshot
 */
export interface MetricsSnapshot {
  timestamp: string;
  connections: ConnectionMetrics;
  events: EventMetrics;
  subscriptions: SubscriptionMetrics;
  performance: PerformanceMetrics;
  errors: ErrorMetrics;
}

export interface ConnectionMetrics {
  active: number;
  total: number;
  connected: number;
  disconnected: number;
}

export interface EventMetrics {
  published: number;
  received: number;
  delivered: number;
  failed: number;
  byType: Record<string, number>;
}

export interface SubscriptionMetrics {
  active: number;
  total: number;
  byPattern: Record<string, number>;
}

export interface PerformanceMetrics {
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
}

export interface ErrorMetrics {
  total: number;
  rate: number;
  byType: Record<string, number>;
  recent: ErrorInfo[];
}

// ============================================================================
// Event Routing & Filtering
// ============================================================================

/**
 * Routing rule for events
 */
export interface RoutingRule {
  id: string;
  pattern: string;
  condition?: FilterCondition;
  targets: RoutingTarget[];
  priority?: number;
  enabled: boolean;
}

export interface RoutingTarget {
  type: 'room' | 'user' | 'channel' | 'broadcast';
  value: string;
  transform?: EventTransform;
}

export interface EventTransform {
  include?: string[];
  exclude?: string[];
  rename?: Record<string, string>;
  addFields?: Record<string, any>;
}

/**
 * Event filter
 */
export interface EventFilter {
  id: string;
  pattern: string;
  conditions: FilterCondition[];
  action: FilterAction;
  priority?: number;
}

export interface FilterAction {
  type: 'allow' | 'deny' | 'transform' | 'throttle';
  transform?: EventTransform;
  throttle?: ThrottleParams;
}

export interface ThrottleParams {
  maxEvents: number;
  windowMs: number;
  key?: string;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Event bus error categories
 */
export type ErrorCategory =
  | 'connection'
  | 'authentication'
  | 'validation'
  | 'timeout'
  | 'rate_limit'
  | 'internal'
  | 'unknown';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: ErrorCategory[];
}

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  resetTimeout: number;
}

// ============================================================================
// Event Bus Client & Server Interfaces
// ============================================================================

/**
 * Event Bus Service interface (used by services)
 */
export interface IEventBusService {
  // Publishing
  publish(eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  publishToRoom(room: string, eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  publishToUser(userId: string, eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  broadcast(eventType: string, data: any, options?: PublishOptions): Promise<PublishResult>;

  // Subscribing
  subscribe(pattern: string, handler: EventHandler, options?: SubscriptionOptions): Promise<Subscription>;
  unsubscribe(subscriptionId: string): Promise<boolean>;

  // Room management
  joinRoom(room: string): Promise<void>;
  leaveRoom(room: string): Promise<void>;
  getRoomMembers(room: string): Promise<string[]>;

  // Health & monitoring
  healthCheck(): Promise<HealthCheckResult>;
  getStats(): Promise<EventBusStats>;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

/**
 * Event Bus Server interface (for running the server)
 */
export interface IEventBusServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): Promise<EventBusStats>;
  healthCheck(): Promise<HealthCheckResult>;
}

// ============================================================================
// WebSocket Specific Types
// ============================================================================

/**
 * Socket event names
 */
export const SocketEvents = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  IDENTIFY: 'identify',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  EVENT: 'event',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  PING: 'ping',
  PONG: 'pong',
} as const;

/**
 * Socket message types
 */
export interface SocketMessage {
  type: string;
  data: any;
  timestamp: string;
  messageId?: string;
}

export interface IdentifyMessage {
  userId: string;
  token?: string;
  metadata?: Record<string, any>;
}

export interface SubscribeMessage {
  pattern: string;
  filter?: SubscriptionFilter;
  options?: SubscriptionOptions;
}

export interface UnsubscribeMessage {
  subscriptionId: string;
}

export interface JoinRoomMessage {
  room: string;
}

export interface LeaveRoomMessage {
  room: string;
}
