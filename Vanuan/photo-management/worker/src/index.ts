import {
  JobQueueCoordinator,
  PhotoProcessingJob,
} from "@shared-infra/job-queue";
import { StorageCoordinator } from "@shared-infra/storage-client";
import { EventBusService } from "@shared-infra/event-bus";
import { PhotoProcessingPipeline } from "./photo-processing-pipeline";
import config from "./config";
import { Worker } from "bullmq";

class WorkerService {
  private jobQueue: JobQueueCoordinator;
  private storage: StorageCoordinator;
  private eventBus: EventBusService;
  private processingPipeline: PhotoProcessingPipeline;
  private worker: Worker | null;

  constructor() {
    this.jobQueue = new JobQueueCoordinator(
      config.jobQueue.redis,
      config.jobQueue.queueName,
    );
    this.storage = new StorageCoordinator(config.storage.s3);
    this.eventBus = new EventBusService(
      config.eventBus.redis,
      config.eventBus.channel,
    );
    this.processingPipeline = new PhotoProcessingPipeline(
      this.storage,
      this.eventBus,
    );
    this.worker = null;
  }

  public async start(): Promise<void> {
    console.log("Worker Service starting...");
    await this.storage.connect();
    await this.eventBus.connect();

    this.worker = this.jobQueue.createWorker(
      config.jobQueue.queueName,
      async (job) => {
        console.log(`Processing job: ${job.id} of type ${job.name}`);
        try {
          const result = await this.processJob(job as PhotoProcessingJob);
          console.log(`Job ${job.id} completed successfully.`);
          return result;
        } catch (error: any) {
          console.error(`Job ${job.id} failed:`, error);
          throw error; // BullMQ handles retries based on worker options
        }
      },
      config.jobQueue.workerConfig,
    );

    this.worker.on("completed", (job) => {
      console.log(`Job ${job.id} has completed`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`Job ${job?.id} has failed with error: ${err.message}`);
    });

    console.log("Worker Service started and listening for jobs.");
  }

  private async processJob(job: PhotoProcessingJob): Promise<any> {
    const photoProcessingJobData = job.data;
    const processingResult = await this.processingPipeline.execute(
      photoProcessingJobData,
    );
    return processingResult;
  }

  public async stop(): Promise<void> {
    console.log("Worker Service stopping...");
    if (this.worker) {
      await this.worker.close();
    }
    await this.jobQueue.disconnect();
    await this.storage.disconnect();
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
