/**
 * Core Types and Interfaces for Job Queue Coordinator
 * @module @shared-infra/job-queue/types
 */

// ============================================================================
// Job Status & State Management
// ============================================================================

export enum JobStatus {
  PENDING = 'pending',
  WAITING = 'waiting',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DELAYED = 'delayed',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
}

export interface JobState {
  id: string;
  name: string;
  queueName: string;
  status: JobStatus;
  progress: number;
  data: unknown;
  result?: unknown;
  error?: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

export interface JobLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Core Job Types
// ============================================================================

export interface PhotoProcessingJob {
  type: 'photo-processing';
  photoId: string;
  userId: string;
  pipeline: PipelineConfig;
  storage: {
    sourceKey: string;
    bucket: string;
    region?: string;
  };
  metadata?: {
    originalFilename?: string;
    mimeType?: string;
    fileSize?: number;
    uploadedAt?: number;
  };
  processing: {
    stages: ProcessingStage[];
    currentStage?: string;
    completedStages?: string[];
  };
  output?: {
    formats?: ThumbnailSize[];
    watermark?: WatermarkConfig;
    quality?: number;
  };
  priority?: number;
}

export interface ProcessingStage {
  name: string;
  type: 'thumbnail' | 'resize' | 'watermark' | 'compress' | 'metadata-extraction';
  config: Record<string, unknown>;
  status?: 'pending' | 'in-progress' | 'completed' | 'failed';
  error?: string;
}

export interface PipelineConfig {
  name: string;
  stages: string[];
  parallel?: boolean;
  continueOnError?: boolean;
}

export interface ThumbnailSize {
  name: string;
  width: number;
  height: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

export interface WatermarkConfig {
  enabled: boolean;
  text?: string;
  imageKey?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  opacity?: number;
}

export interface BatchProcessingJob {
  type: 'batch-processing';
  batchId: string;
  photoIds: string[];
  operation: 'resize' | 'compress' | 'watermark' | 'metadata-update';
  config: Record<string, unknown>;
  userId: string;
  progress?: {
    total: number;
    completed: number;
    failed: number;
  };
}

export interface CleanupJob {
  type: 'cleanup';
  target: 'temp-files' | 'failed-jobs' | 'old-logs' | 'orphaned-data';
  olderThanDays?: number;
  dryRun?: boolean;
  filters?: Record<string, unknown>;
}

// ============================================================================
// Queue Configuration
// ============================================================================

export interface QueueConfig {
  name: string;
  defaultJobOptions?: JobOptions;
  rateLimiter?: RateLimiterConfig;
  cleanupPolicy?: CleanupPolicy;
  retryPolicy?: RetryPolicy;
  concurrency?: number;
  priority?: boolean;
}

export interface JobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: BackoffOptions;
  timeout?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  stackTraceLimit?: number;
  jobId?: string;
  repeat?: RepeatOptions;
}

export interface BackoffOptions {
  type: 'fixed' | 'exponential';
  delay: number;
}

export interface RepeatOptions {
  cron?: string;
  every?: number;
  limit?: number;
  immediately?: boolean;
}

export interface RateLimiterConfig {
  max: number;
  duration: number;
  groupKey?: string;
}

export interface CleanupPolicy {
  completedJobsMaxAge?: number;
  failedJobsMaxAge?: number;
  completedJobsMaxCount?: number;
  failedJobsMaxCount?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'custom';
  initialDelay: number;
  maxDelay?: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

// ============================================================================
// Queue Status & Health
// ============================================================================

export interface QueueStatus {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  isPaused: boolean;
  health: QueueHealthStatus;
}

export interface QueueHealthStatus {
  status: HealthStatus;
  message: string;
  metrics: QueueHealthMetrics;
  issues: HealthIssue[];
  recommendations?: HealthRecommendation[];
  lastCheck: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface QueueHealthMetrics {
  processingRate: number;
  averageWaitTime: number;
  averageProcessingTime: number;
  errorRate: number;
  throughput: number;
  queueDepth: number;
  oldestJobAge?: number;
}

export interface HealthIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metric?: string;
}

export interface HealthRecommendation {
  action: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
}

// ============================================================================
// Worker Configuration
// ============================================================================

export interface WorkerConfig {
  queueName: string;
  processor: JobProcessor;
  concurrency?: number;
  options?: WorkerOptions;
}

export interface WorkerOptions {
  concurrency?: number;
  limiter?: RateLimiterConfig;
  stalledInterval?: number;
  maxStalledCount?: number;
  autorun?: boolean;
  lockDuration?: number;
  lockRenewTime?: number;
}

export interface WorkerStatus {
  id: string;
  queueName: string;
  isRunning: boolean;
  isPaused: boolean;
  activeJobs: number;
  processedJobs: number;
  failedJobs: number;
  lastActive?: number;
}

export interface ManagedWorker {
  id: string;
  queueName: string;
  worker: unknown; // BullMQ Worker instance
  processor: JobProcessor;
  options: WorkerOptions;
  startedAt: number;
  status: WorkerStatus;
}

// ============================================================================
// Worker Pool & Scaling
// ============================================================================

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  targetQueueLength?: number;
  scaleUpThreshold?: number;
  scaleDownThreshold?: number;
  cooldownPeriod?: number;
}

export interface AutoScalingPolicy {
  enabled: boolean;
  minWorkers: number;
  maxWorkers: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  checkInterval: number;
  cooldownPeriod: number;
}

export interface ScalingResult {
  success: boolean;
  previousCount: number;
  newCount: number;
  message: string;
}

// ============================================================================
// Job Processing
// ============================================================================

export interface JobProcessingContext {
  jobId: string;
  queueName: string;
  attemptsMade: number;
  timestamp: number;
  workerId?: string;
}

export type JobProcessor<T = unknown, R = unknown> = (
  job: Job<T>,
  context?: JobProcessingContext
) => Promise<R>;

export interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  opts: JobOptions;
  progress: number | object;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  returnvalue?: unknown;
  failedReason?: string;
  stacktrace?: string[];
  updateProgress(progress: number | object): Promise<void>;
  log(message: string): Promise<void>;
  moveToCompleted(returnvalue: unknown, ignoreLock?: boolean): Promise<void>;
  moveToFailed(errorInfo: Error, ignoreLock?: boolean): Promise<void>;
}

// ============================================================================
// Scheduling
// ============================================================================

export interface ScheduleOptions {
  priority?: number;
  delayMs?: number;
  maxRetries?: number;
  backoffStrategy?: BackoffOptions;
  timeout?: number;
  jobId?: string;
  tags?: string[];
}

export interface RecurringJobOptions extends ScheduleOptions {
  cronExpression: string;
  timezone?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface RepeatableJob {
  id: string;
  name: string;
  queueName: string;
  cronExpression: string;
  nextRun: number;
  options: RecurringJobOptions;
}

// ============================================================================
// Error Handling & Retry
// ============================================================================

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  reason?: string;
}

export interface RetryStatistics {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageRetryDelay: number;
}

export interface FailedJob {
  id: string;
  queueName: string;
  name: string;
  data: unknown;
  error: string;
  stackTrace?: string[];
  attemptsMade: number;
  failedAt: number;
  originalJobId: string;
  canRetry: boolean;
}

export interface FailedJobStatistics {
  total: number;
  byQueue: Record<string, number>;
  byErrorType: Record<string, number>;
  recentFailures: number;
}

// ============================================================================
// Metrics & Monitoring
// ============================================================================

export interface QueueMetrics {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  processingRate: number;
  throughput: number;
  averageProcessingTime: number;
  errorRate: number;
}

export interface JobQueueMetricsSnapshot {
  timestamp: number;
  queues: QueueMetricsSnapshot[];
  workers: WorkerMetricsSnapshot[];
  system: SystemMetricsSnapshot;
}

export interface QueueMetricsSnapshot {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  rates: {
    processing: number;
    throughput: number;
    error: number;
  };
  timings: {
    averageWaitTime: number;
    averageProcessingTime: number;
    p95ProcessingTime?: number;
    p99ProcessingTime?: number;
  };
}

export interface WorkerMetricsSnapshot {
  queueName: string;
  workerCount: number;
  activeWorkers: number;
  totalProcessed: number;
  totalFailed: number;
}

export interface SystemMetricsSnapshot {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    percentage: number;
  };
  uptime: number;
}

// ============================================================================
// Security
// ============================================================================

export interface SecurityConfig {
  enableInputValidation: boolean;
  maxJobDataSize: number;
  allowedJobTypes?: string[];
  deniedJobTypes?: string[];
  rateLimiting?: RateLimiterConfig;
  auditLogging?: boolean;
}

export interface Permission {
  action: 'enqueue' | 'process' | 'cancel' | 'retry' | 'view';
  resource: string;
  conditions?: PermissionCondition[];
}

export interface PermissionCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches';
  value: unknown;
}

// ============================================================================
// Configuration
// ============================================================================

export interface JobQueueCoordinatorConfig {
  redis: RedisConfig;
  queues?: QueueConfig[];
  workers?: WorkerConfig[];
  metrics?: MetricsConfig;
  logging?: LoggingConfig;
  security?: SecurityConfig;
  performance?: PerformanceConfig;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  connectTimeout?: number;
  tls?: {
    enabled: boolean;
    ca?: string;
  };
}

export interface MetricsConfig {
  enabled: boolean;
  collectInterval?: number;
  exporters?: ('console' | 'prometheus' | 'custom')[];
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format?: 'json' | 'text';
  destination?: 'console' | 'file' | 'custom';
}

export interface PerformanceConfig {
  enableAutoScaling?: boolean;
  enableOptimization?: boolean;
  metricsRetentionDays?: number;
}

// ============================================================================
// Optimization
// ============================================================================

export interface OptimizationResult {
  success: boolean;
  actions: OptimizationAction[];
  performanceScore: number;
  bottlenecks: BottleneckAnalysis;
}

export interface OptimizationAction {
  type: 'scale-workers' | 'adjust-concurrency' | 'modify-rate-limit' | 'cleanup';
  description: string;
  expectedImpact: 'low' | 'medium' | 'high';
}

export interface BottleneckAnalysis {
  queueDepth: boolean;
  workerUtilization: boolean;
  processingSpeed: boolean;
  errorRate: boolean;
}

// ============================================================================
// Events
// ============================================================================

export interface QueueEventHandlers {
  onCompleted?: (job: Job, result: unknown) => void | Promise<void>;
  onFailed?: (job: Job, error: Error) => void | Promise<void>;
  onProgress?: (job: Job, progress: number | object) => void | Promise<void>;
  onPaused?: () => void | Promise<void>;
  onResumed?: () => void | Promise<void>;
  onCleaned?: (jobs: string[], type: string) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface WorkerEventHandlers {
  onActive?: (job: Job) => void | Promise<void>;
  onCompleted?: (job: Job, result: unknown) => void | Promise<void>;
  onFailed?: (job: Job, error: Error, prev?: string) => void | Promise<void>;
  onProgress?: (job: Job, progress: number | object) => void | Promise<void>;
  onStalled?: (jobId: string) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}
