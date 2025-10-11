import { createJobQueueCoordinator, JobQueueCoordinator } from "@shared-infra/job-queue";
import { StorageClient } from "@shared-infra/storage-client";
import { EventBusClient } from "@shared-infra/event-bus";
import { PhotoProcessingPipeline } from "./photo-processing-pipeline";
import config from "./config";
import Minio from "minio";

class WorkerService {
  private jobQueue: JobQueueCoordinator;
  private storageClient: StorageClient;
  private eventBus: EventBusClient;
  private minio: Minio.Client;
  private processingPipeline: PhotoProcessingPipeline;

  constructor() {
    this.jobQueue = createJobQueueCoordinator({
      redis: {
        host: config.jobQueue.redis.host,
        port: config.jobQueue.redis.port,
      },
    } as any);

    this.storageClient = new StorageClient({
      storageServiceUrl: process.env.STORAGE_SERVICE_URL || "http://localhost:3001",
      minioConfig: {
        endPoint: (process.env.MINIO_ENDPOINT || "localhost").replace(/^https?:\/\//, ""),
        port: parseInt(process.env.MINIO_PORT || "9000", 10),
        useSSL: process.env.MINIO_USE_SSL === "true",
        accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
        secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
        region: process.env.MINIO_REGION || "us-east-1",
      },
    });

    this.minio = new Minio.Client({
      endPoint: (process.env.MINIO_ENDPOINT || "localhost").replace(/^https?:\/\//, ""),
      port: parseInt(process.env.MINIO_PORT || "9000", 10),
      useSSL: process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
      region: process.env.MINIO_REGION || "us-east-1",
    });

    this.eventBus = new EventBusClient({
      serviceName: "photo-processing-worker",
      redis: {
        host: config.eventBus.redis.host,
        port: config.eventBus.redis.port,
      },
    } as any);

    this.processingPipeline = new PhotoProcessingPipeline(
      this.minio,
      this.storageClient,
      this.eventBus,
    );
  }

  public async start(): Promise<void> {
    console.log("Worker Service starting...");
    await this.eventBus.connect();

    await this.jobQueue.initialize?.();

    await this.jobQueue.registerWorker(
      process.env.JOB_QUEUE_NAME || "photo-processing",
      async (job: any) => {
        console.log(`Processing job: ${job.id} of type ${job.name}`);
        try {
          const result = await this.processJob(job.data);
          console.log(`Job ${job.id} completed successfully.`);
          return result as any;
        } catch (error: any) {
          console.error(`Job ${job.id} failed:`, error);
          throw error;
        }
      },
      { concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10) }
    );

    console.log("Worker Service started and listening for jobs.");
  }

  private async processJob(jobData: any): Promise<any> {
    const normalized = {
      photoId: jobData.photoId,
      userId: jobData.userId,
      originalFileKey: jobData.filepath || jobData.originalFileKey,
      mimeType: jobData.mimeType || "image/jpeg",
      metadata: jobData.metadata || {},
    };
    const processingResult = await this.processingPipeline.execute(normalized);
    return processingResult;
  }

  public async stop(): Promise<void> {
    console.log("Worker Service stopping...");
    await this.jobQueue.shutdown?.();
    await this.eventBus.disconnect();
    console.log("Worker Service stopped.");
  }
}

const workerService = new WorkerService();

// Start the worker service
workerService.start().catch((err) => {
  console.error("Failed to start Worker Service:", err);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await workerService.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await workerService.stop();
  process.exit(0);
});
