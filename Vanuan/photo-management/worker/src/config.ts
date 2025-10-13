import "dotenv/config";

interface RedisConfig {
  host: string;
  port: number;
}

interface JobQueueConfig {
  redis: RedisConfig;
  queueName: string;
  workerConfig: {
    concurrency: number;
    attempts: number;
    backoff: {
      type: string;
      delay: number;
    };
  };
}

interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  sslEnabled: boolean;
  forcePathStyle: boolean;
}

interface StorageConfig {
  s3: S3Config;
}

interface EventBusConfig {
  redis: RedisConfig;
  channel: string;
}

interface PhotoProcessingConfig {
  thumbnailSizes: number[];
  optimizationQuality: number;
}

interface AppConfig {
  environment: string;
  jobQueue: JobQueueConfig;
  storage: StorageConfig;
  eventBus: EventBusConfig;
  photoProcessing: PhotoProcessingConfig;
}

const config: AppConfig = {
  environment: process.env.NODE_ENV || "development",
  jobQueue: {
    redis: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    },
    queueName: process.env.JOB_QUEUE_NAME || "photo-queue",
    workerConfig: {
      concurrency: parseInt(process.env.JOB_WORKER_CONCURRENCY || "5", 10),
      attempts: parseInt(process.env.JOB_ATTEMPTS || "3", 10),
      backoff: {
        type: process.env.JOB_BACKOFF_TYPE || "exponential",
        delay: parseInt(process.env.JOB_BACKOFF_DELAY || "1000", 10), // 1 second
      },
    },
  },
  storage: {
    s3: {
      endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
      accessKeyId: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.MINIO_SECRET_KEY || "minioadmin123",
      bucketName: process.env.S3_BUCKET_NAME || "photo-management",
      sslEnabled: process.env.S3_SSL_ENABLED === "true",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", // Required for MinIO
    },
  },
  eventBus: {
    redis: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
    },
    channel: process.env.EVENT_BUS_CHANNEL || "photo-events",
  },
  photoProcessing: {
    thumbnailSizes: process.env.THUMBNAIL_SIZES
      ? process.env.THUMBNAIL_SIZES.split(",").map((s) =>
          parseInt(s.trim(), 10),
        )
      : [150, 300, 600], // Default thumbnail sizes
    optimizationQuality: parseInt(process.env.OPTIMIZATION_QUALITY || "80", 10), // JPEG quality
  },
};

export default config;
