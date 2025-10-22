/**
 * Job Queue Coordinator - Main entry point
 * @module @shared-infra/job-queue
 */

// Main Coordinator
export { JobQueueCoordinator, createJobQueueCoordinator } from './coordinator';
export type { EnqueueJobOptions } from './coordinator';

// Core Components
export { QueueManager } from './core/queue-manager';
export type { QueueManagerConfig } from './core/queue-manager';
export { JobScheduler } from './core/job-scheduler';
export { WorkerManager } from './core/worker-manager';

// Types and Interfaces
export {
  JobStatus,
  type JobState,
  type JobLogEntry,
  type PhotoProcessingJob,
  type ProcessingStage,
  type PipelineConfig,
  type ThumbnailSize,
  type WatermarkConfig,
  type BatchProcessingJob,
  type CleanupJob,
  type QueueConfig,
  type JobOptions,
  type BackoffOptions,
  type RepeatOptions,
  type RateLimiterConfig,
  type CleanupPolicy,
  type RetryPolicy,
  type QueueStatus,
  type QueueHealthStatus,
  type HealthStatus,
  type QueueHealthMetrics,
  type HealthIssue,
  type HealthRecommendation,
  type WorkerConfig,
  type WorkerOptions,
  type WorkerStatus,
  type ManagedWorker,
  type WorkerPoolConfig,
  type AutoScalingPolicy,
  type ScalingResult,
  type JobProcessingContext,
  type JobProcessor,
  type Job,
  type ScheduleOptions,
  type RecurringJobOptions,
  type RepeatableJob,
  type RetryDecision,
  type RetryStatistics,
  type FailedJob,
  type FailedJobStatistics,
  type QueueMetrics,
  type JobQueueMetricsSnapshot,
  type QueueMetricsSnapshot,
  type WorkerMetricsSnapshot,
  type SystemMetricsSnapshot,
  type SecurityConfig,
  type Permission,
  type PermissionCondition,
  type JobQueueCoordinatorConfig,
  type RedisConfig,
  type MetricsConfig,
  type LoggingConfig,
  type PerformanceConfig,
  type OptimizationResult,
  type OptimizationAction,
  type BottleneckAnalysis,
  type QueueEventHandlers,
  type WorkerEventHandlers,
} from './types';

// Import types for internal use
import type { QueueConfig, JobQueueCoordinatorConfig } from './types';

// Utilities
export { Logger, createLogger, defaultLogger, LogLevel } from './utils/logger';
export type { LogContext, LogEntry } from './utils/logger';

// Re-export BullMQ types for convenience
export type { Queue, Worker, Job as BullMQJob } from 'bullmq';

/**
 * Default configuration presets
 */
export const DEFAULT_QUEUE_CONFIGS = {
  /**
   * High-priority queue for time-sensitive operations
   */
  highPriority: {
    name: 'high-priority',
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential' as const,
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: false,
    },
    concurrency: 10,
  } as QueueConfig,

  /**
   * Standard queue for normal operations
   */
  standard: {
    name: 'standard',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: false,
    },
    concurrency: 5,
  } as QueueConfig,

  /**
   * Low-priority background queue
   */
  background: {
    name: 'background',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 5000,
      },
      removeOnComplete: 50,
      removeOnFail: false,
    },
    concurrency: 2,
  } as QueueConfig,

  /**
   * Photo processing queue optimized for image operations
   */
  photoProcessing: {
    name: 'photo-processing',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 2000,
      },
      timeout: 60000, // 60 seconds
      removeOnComplete: 100,
      removeOnFail: false,
    },
    cleanupPolicy: {
      completedJobsMaxAge: 24 * 60 * 60 * 1000, // 24 hours
      failedJobsMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      completedJobsMaxCount: 1000,
      failedJobsMaxCount: 5000,
    },
    concurrency: 5,
  } as QueueConfig,
};

/**
 * Helper function to create a simple coordinator configuration
 */
export function createSimpleConfig(redisHost: string, redisPort = 6379): JobQueueCoordinatorConfig {
  return {
    redis: {
      host: redisHost,
      port: redisPort,
      keyPrefix: 'bull:',
    },
    logging: {
      level: 'info',
      format: 'json',
    },
    metrics: {
      enabled: true,
    },
  };
}

/**
 * Version information
 */
export const VERSION = '1.0.0';

/**
 * Library metadata
 */
export const LIBRARY_INFO = {
  name: '@shared-infra/job-queue',
  version: VERSION,
  description: 'Job Queue Coordinator library for photo management system',
  author: 'Your Organization',
};
