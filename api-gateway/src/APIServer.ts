import express from "express";
import http from "http";
import multer from "multer";
import { PhotoPage } from "@shared-infra/storage-core";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";

// Import shared-infra packages using aliases and correct exports
import {
  createEventBusClient,
  EventBusClient,
  HealthCheckResult as EventBusHealthCheckResult,
  PhotoProcessingCompletedData,
  PhotoProcessingFailedData,
  PhotoProcessingProgressData,
} from "@shared-infra/event-bus";
import {
  createJobQueueCoordinator,
  JobQueueCoordinator,
  HealthStatus as JobQueueHealthStatus,
  QueueStatus, // Import QueueStatus from shared-infra
} from "@shared-infra/job-queue";
import {
  StorageClient,
  PhotoResult, // Result type from storage-client's storePhoto
  StorePhotoOptions as StorageClientStorePhotoOptions, // Options for storePhoto from storage-client
} from "@shared-infra/storage-client";
import {
  HealthStatus as StorageCoreHealthStatus,
  Photo, // Full photo data structure from storage-core
  ProcessingStatus, // Enum for processing status from storage-core
} from "@shared-infra/storage-core";

// Define API Gateway's internal ClientPhotoMetadata for client responses
interface ClientPhotoMetadata {
  id: string;
  userId: string; // Mapped from photo.user_id (ensured as string)
  filename: string; // Mapped from photo.original_filename
  filepath: string; // Mapped from photo.s3_key
  mimeType: string; // Mapped from photo.mime_type
  size: number;
  uploadTimestamp: string; // Mapped from photo.uploaded_at
  processingStatus: ProcessingStatus; // Mapped from photo.processing_status
  url?: string; // Optional, for direct access URLs
}

// Define PhotoProcessingJob specific to API Gateway for enqueuing
interface PhotoProcessingJob {
  id: string; // Unique ID for the job
  photoId: string; // ID of the photo being processed
  userId: string; // ID of the user who uploaded the photo
  filename: string; // Original filename
  filepath: string; // Path to the original file in storage (s3_key equivalent)
  mimeType: string; // MIME type of the photo
  size: number; // Size of the photo in bytes
  uploadTimestamp: string; // ISO timestamp of upload
  processingStatus: "pending" | "in_progress" | "completed" | "failed"; // Internal status for job queue
  operations: Array<{
    type: "thumbnail" | "resize" | "watermark" | "metadata";
    config: any; // Operation-specific configuration
  }>;
  originalFileHash?: string;
  sourceIp?: string;
  deviceInfo?: string;
  callbackUrl?: string; // For webhooks
}

// Wrapper for EventBus event data as they usually come with a 'data' property
interface EventDataWrapper<T> {
  data: T;
}

// Error category enum
enum ErrorCategory {
  Validation = "VALIDATION_ERROR",
  Authentication = "AUTHENTICATION_ERROR",
  Authorization = "AUTHORIZATION_ERROR",
  NotFound = "NOT_FOUND_ERROR",
  Conflict = "CONFLICT_ERROR",
  ServiceUnavailable = "SERVICE_UNAVAILABLE_ERROR",
  Internal = "INTERNAL_SERVER_ERROR",
  External = "EXTERNAL_SERVICE_ERROR",
  Unknown = "UNKNOWN_ERROR",
}

interface JobQueueWorkerDetails {
  total: number;
  active: number;
  paused: number;
}

interface JobQueueCheckDetails {
  queues?: QueueStatus[]; // Refers to the imported QueueStatus
  workers?: JobQueueWorkerDetails;
}

interface JobQueueCheckResult {
  status: "pass" | "fail";
  message: string;
  details?: JobQueueCheckDetails;
}

interface JobQueueDetailedHealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime: number;
  checks: {
    queues?: JobQueueCheckResult;
    // Changed to JobQueueCheckResult as it has status, message, and optional details
    workers?: JobQueueCheckResult;
    connection?: JobQueueCheckResult;
  };
}

// Aggregate Health status interface for this service
interface AggregateHealthStatus {
  status: "ok" | "degraded" | "unavailable"; // Standardized status for API Gateway
  timestamp: string;
  details?: {
    storage?: {
      status: "ok" | "unavailable"; // Mapped from StorageCoreHealthStatus's service field
      message?: string;
      details?: StorageCoreHealthStatus; // Original detailed status
    };
    eventBus?: EventBusHealthCheckResult;
    jobQueue?: JobQueueDetailedHealthStatus;
  };
  message?: string;
  error?: string;
}

export class APIServer {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private storageClient: StorageClient;
  private eventBusClient: EventBusClient;
  private jobCoordinatorClient: JobQueueCoordinator;
  private upload: multer.Multer;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ["http://localhost:3000"],
        methods: ["GET", "POST"]
      }
    });

    // Initialize StorageClient
    this.storageClient = new StorageClient({
      storageServiceUrl:
        process.env.STORAGE_SERVICE_URL || "http://localhost:9000",
      minioConfig: {
        endPoint: process.env.MINIO_ENDPOINT || "localhost",
        port: parseInt(process.env.MINIO_PORT || "9000", 10),
        useSSL: process.env.MINIO_USE_SSL === "true",
        accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
        secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
      },
      cacheConfig: { enabled: true, ttl: 300, maxSize: 100 },
    });

    // Initialize EventBusClient
    this.eventBusClient = createEventBusClient({
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      serviceName: "api-gateway",
      logLevel: (process.env.LOG_LEVEL as any) || "info",
    });

    // Initialize JobQueueCoordinator
    this.jobCoordinatorClient = createJobQueueCoordinator({
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        password: process.env.REDIS_PASSWORD || undefined,
      },
      queues: [
        {
          name: "photo-processing",
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            timeout: 60000,
          },
          cleanupPolicy: {
            completedJobsMaxAge: 24 * 60 * 60 * 1000,
            failedJobsMaxAge: 7 * 24 * 60 * 60 * 1000,
          },
        },
      ],
      // Removed logLevel as per diagnostic, JobQueueCoordinatorConfig does not have it.
    });

    // Multer setup for file uploads
    this.upload = multer({ storage: multer.memoryStorage() });
  }

  public async initialize(): Promise<void> {
    await this.initializeSharedInfra();
    await this.verifyConnections();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
    await this.setupEventSubscriptions();
    this.setupGracefulShutdown();
  }

  private setupSocketIO(): void {
    this.io.on('connection', (socket: any) => {
      console.log('Client connected via WebSocket:', socket.id);

      const { clientId, userId, sessionId } = socket.handshake.auth;

      // Join rooms for targeted messaging
      if (clientId) socket.join(`client:${clientId}`);
      if (userId) socket.join(`user:${userId}`);
      if (sessionId) socket.join(`session:${sessionId}`);

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });
  }

  private async initializeSharedInfra(): Promise<void> {
    console.log("Connecting to shared infrastructure...");
    await this.eventBusClient.connect(); // EventBusClient has a connect method
    // JobCoordinator connect is handled internally by BullMQ when operations are performed,
    // or by `initialize` directly if it has a specific connect method.
    // For now, assuming `createJobQueueCoordinator` sets up connections.
    console.log("Shared infrastructure connection setup initiated.");
  }

  private async verifyConnections(): Promise<void> {
    console.log("Verifying connections to shared infrastructure...");
    try {
      const storageHealth = await this.storageClient.healthCheck();
      if (storageHealth.service !== "healthy") {
        // Check against 'healthy' from StorageCoreHealthStatus
        throw new Error(
          `StorageClient health check failed: ${storageHealth.service}`,
        );
      }
      console.log("StorageClient connection verified.");

      const eventBusHealth = await this.eventBusClient.healthCheck();
      if (eventBusHealth.status !== "healthy") {
        throw new Error(
          `EventBus health check failed: ${eventBusHealth.status}`,
        );
      }
      console.log("EventBus connection verified.");

      const jobCoordinatorHealth = await this.jobCoordinatorClient.getHealth();
      if (jobCoordinatorHealth.status !== "healthy") {
        throw new Error(
          `JobCoordinator health check failed: ${jobCoordinatorHealth.status}`,
        );
      }
      console.log("JobCoordinator connection verified.");

      console.log("All shared infrastructure connections verified.");
    } catch (error: any) {
      console.error(
        "Failed to verify shared infrastructure connections:",
        error.message,
      );
      process.exit(1); // Exit if critical connections fail
    }
  }

  private setupMiddleware(): void {
    console.log("Setting up middleware...");
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cors()); // Enable CORS for client applications
    console.log("Middleware setup complete.");
  }

  private setupRoutes(): void {
    console.log("Setting up routes...");
    this.app.post(
      "/photos/upload",
      this.upload.single("photo") as any,
      this.handlePhotoUpload.bind(this),
    );
    this.app.get("/photos", this.handleListPhotos.bind(this));
    this.app.get("/photos/:photoId", this.handleGetPhoto.bind(this));
    this.app.get(
      "/photos/:photoId/status",
      this.handleGetPhotoStatus.bind(this),
    );
    this.app.delete("/photos/:photoId", this.handleDeletePhoto.bind(this));
    this.app.get("/health", this.handleDetailedHealth.bind(this));

    // 404 Not Found handler
    this.app.use(this.handleNotFound.bind(this));
    // Centralized error handler
    this.app.use(this.handleError.bind(this));
    console.log("Routes setup complete.");
  }

  private async setupEventSubscriptions(): Promise<void> {
    console.log("Setting up event subscriptions...");
    // Subscribe to photo processing events to update status or notify users
    await this.eventBusClient.subscribe(
      "photo.processing.completed",
      async (event: EventDataWrapper<PhotoProcessingCompletedData>) => {
        console.log(
          `Photo processing completed for photoId: ${event.data.photoId}`,
        );

        // WebSocket broadcast
        if (event.data.userId) {
          this.io.to(`user:${event.data.userId}`).emit('photo.processing.completed', {
            photoId: event.data.photoId,
            status: 'completed',
            timestamp: new Date().toISOString()
          });
        }

        // Update photo metadata in storage and notify user
        await this.storageClient.updatePhotoMetadata(event.data.photoId, {
          processing_status: "completed", // Use processing_status from StorageCorePhotoMetadata
        });
        if (event.data.userId) {
          await this.eventBusClient.publishToUser(
            event.data.userId,
            "photo.status.updated",
            {
              photoId: event.data.photoId,
              status: "completed",
              message: "Your photo has been successfully processed.",
            },
          );
        }
      },
    );

    await this.eventBusClient.subscribe(
      "photo.processing.failed",
      async (event: EventDataWrapper<PhotoProcessingFailedData>) => {
        console.error(
          `Photo processing failed for photoId: ${event.data.photoId}. Reason: ${event.data.error?.message || "Unknown reason"}`,
        );

        // WebSocket broadcast
        if (event.data.userId) {
          this.io.to(`user:${event.data.userId}`).emit('photo.processing.failed', {
            photoId: event.data.photoId,
            status: 'failed',
            error: event.data.error?.message || "Unknown reason",
            timestamp: new Date().toISOString()
          });
        }

        // Update photo metadata in storage and notify user
        await this.storageClient.updatePhotoMetadata(event.data.photoId, {
          processing_status: "failed", // Use processing_status
        });
        if (event.data.userId) {
          await this.eventBusClient.publishToUser(
            event.data.userId,
            "photo.status.updated",
            {
              photoId: event.data.photoId,
              status: "failed",
              message: `Photo processing failed: ${event.data.error?.message || "Unknown reason"}`,
            },
          );
        }
      },
    );

    await this.eventBusClient.subscribe(
      "photo.processing.progress",
      async (event: EventDataWrapper<PhotoProcessingProgressData>) => {
        console.log(
          `Photo processing progress for photoId: ${event.data.photoId}. Progress: ${event.data.progress}%`,
        );

        // WebSocket broadcast
        if (event.data.userId) {
          this.io.to(`user:${event.data.userId}`).emit('photo.processing.progress', {
            photoId: event.data.photoId,
            status: 'in_progress',
            progress: event.data.progress,
            timestamp: new Date().toISOString()
          });
        }

        // Optionally update photo metadata in storage or notify user
        if (event.data.userId) {
          await this.eventBusClient.publishToUser(
            event.data.userId,
            "photo.status.updated",
            {
              photoId: event.data.photoId,
              status: "in_progress",
              progress: event.data.progress,
              message: "Your photo is being processed.",
            },
          );
        }
      },
    );

    console.log("Event subscriptions setup complete.");
  }

  private async handlePhotoUpload(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      if (!req.file) {
        console.log("No file provided in request");
        // WebSocket error notification
        const clientId = req.body.clientId || req.headers['x-client-id'];
        if (clientId) {
          this.io.to(`client:${clientId}`).emit('photo.upload.failed', {
            error: "No photo file provided.",
            timestamp: new Date().toISOString()
          });
        }

        res.status(400).json({
          error: ErrorCategory.Validation,
          message: "No photo file provided.",
        });
        return;
      }

      const userId = (req.headers["x-user-id"] as string) || "anonymous";
      const clientId = req.body.clientId || req.headers['x-client-id'] || userId;
      const uploadTimestamp = new Date().toISOString();
      const { originalname, mimetype, size, buffer } = req.file;

      console.log(
        `Received upload for userId: ${userId}, filename: ${originalname}, size: ${size}`,
      );

      // Prepare options for storage using StorePhotoOptions from storage-client/types.ts
      const storePhotoOptions: StorageClientStorePhotoOptions = {
        originalName: originalname,
        contentType: mimetype,
        clientId: userId, // Using userId as clientId for now
        userId: userId,
        // The StorageClient will generate an ID and other metadata
        // We pass enough info for it to create the Photo record
      };

      console.log("Attempting to store photo using StorageClient...");
      // Store the photo using StorageClient
      let storedPhotoResult: PhotoResult;
      try {
        storedPhotoResult = await this.storageClient.storePhoto(buffer, storePhotoOptions);
        console.log("Photo stored successfully:", storedPhotoResult);
      } catch (error) {
        console.error("Failed to store photo in StorageClient:", error);
        throw new Error(`StorageClient error: ${error.message}`);
      }

      if (!storedPhotoResult.id) {
        throw new Error("Failed to store photo, no id returned.");
      }

      // Enqueue a photo processing job
      const photoProcessingJob: PhotoProcessingJob = {
        id: uuidv4(), // Job ID
        photoId: storedPhotoResult.id,
        userId: userId,
        filename: originalname,
        filepath: storedPhotoResult.s3_key, // Use s3_key from storeResult as filepath for job
        mimeType: mimetype,
        size: size,
        uploadTimestamp: uploadTimestamp,
        processingStatus: "pending", // This is API gateway's internal status for the job
        operations: [
          { type: "thumbnail", config: { size: "medium" } },
          { type: "resize", config: { width: 800 } },
        ], // Example operations
      };

      console.log("Attempting to enqueue photo processing job...");
      try {
        await this.jobCoordinatorClient.enqueueJob(
          "photo-processing",
          photoProcessingJob,
          { jobId: photoProcessingJob.id },
        );
        console.log(
          `Enqueued photo processing job for photoId: ${photoProcessingJob.photoId}`,
        );
      } catch (error) {
        console.error("Failed to enqueue photo processing job:", error);
        throw new Error(`Job queue error: ${error.message}`);
      }

      // WebSocket notification for upload
      if (clientId) {
        this.io.to(`client:${clientId}`).emit('photo.uploaded', {
          photoId: photoProcessingJob.photoId,
          filename: photoProcessingJob.filename,
          status: 'queued',
          jobId: photoProcessingJob.id,
          timestamp: new Date().toISOString()
        });
      }

      // Publish photo.uploaded event
      console.log("Attempting to publish photo.uploaded event...");
      try {
        await this.eventBusClient.publish("photo.uploaded", {
          photoId: photoProcessingJob.photoId,
          userId: photoProcessingJob.userId,
          filename: photoProcessingJob.filename,
          uploadTimestamp: photoProcessingJob.uploadTimestamp,
          status: "pending", // Event status
        });
        console.log(
          `Published photo.uploaded event for photoId: ${photoProcessingJob.photoId}`,
        );
      } catch (error) {
        console.error("Failed to publish photo.uploaded event:", error);
        throw new Error(`Event bus error: ${error.message}`);
      }

      res.status(202).json({
        message: "Photo uploaded and being processed",
        photoId: storedPhotoResult.id,
        userId: userId,
        filename: originalname,
        status: "pending",
        // Inform client about WebSocket events
        realtimeUpdates: true,
        subscribeEvents: [`photo:${storedPhotoResult.id}`, `client:${clientId}`]
      });
    } catch (error: any) {
      console.error("Error handling photo upload:", error);
      console.error("Error stack:", error.stack);

      // WebSocket error notification
      const clientId = req.body.clientId || req.headers['x-client-id'];
      if (clientId) {
        this.io.to(`client:${clientId}`).emit('photo.upload.failed', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }

      res.status(500).json({
        error: ErrorCategory.Internal,
        message: error.message || "Internal server error during photo upload.",
      });
    }
  }

  private async handleListPhotos(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const userId = (req.headers["x-user-id"] as string) || "anonymous";
      const limit = parseInt((req.query.limit as string) || "20", 10);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      // getUserPhotos from StorageClient returns PhotoPage (from storage-core)
      const photoPage: PhotoPage = await this.storageClient.getUserPhotos(
        userId,
        {
          limit,
          offset,
        },
      );

      // Map Photo (from storage-core) to a more client-friendly ClientPhotoMetadata
      const clientPhotos: ClientPhotoMetadata[] = photoPage.photos.map(
        (photo) => ({
          id: photo.id,
          userId: photo.user_id || "anonymous", // Ensure userId is string
          filename: photo.original_filename,
          filepath: photo.s3_key, // For client, this acts as the "filepath"
          mimeType: photo.mime_type,
          size: photo.size,
          uploadTimestamp: photo.uploaded_at,
          processingStatus: photo.processing_status,
        }),
      );

      res.status(200).json({
        photos: clientPhotos,
        pagination: photoPage.pagination,
      });
    } catch (error: any) {
      console.error("Error listing photos:", error);
      res.status(500).json({
        error: ErrorCategory.Internal,
        message: error.message || "Internal server error listing photos.",
      });
    }
  }

  private async handleGetPhoto(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const { photoId } = req.params;
      const photo: Photo | null = await this.storageClient.getPhoto(photoId); // Returns Photo or null

      if (!photo) {
        res
          .status(404)
          .json({ error: ErrorCategory.NotFound, message: "Photo not found." });
        return;
      }

      // Generate a pre-signed URL for direct access to the photo
      const photoUrl = await this.storageClient.getPhotoUrl(photoId, 3600); // URL valid for 1 hour

      // Map Photo (from storage-core) to a more client-friendly ClientPhotoMetadata with URL
      const clientPhoto: ClientPhotoMetadata = {
        id: photo.id,
        userId: photo.user_id || "anonymous",
        filename: photo.original_filename,
        filepath: photo.s3_key,
        mimeType: photo.mime_type,
        size: photo.size,
        uploadTimestamp: photo.uploaded_at,
        processingStatus: photo.processing_status,
        url: photoUrl,
      };

      res.status(200).json(clientPhoto);
    } catch (error: any) {
      console.error("Error getting photo:", error);
      res.status(500).json({
        error: ErrorCategory.Internal,
        message: error.message || "Internal server error getting photo.",
      });
    }
  }

  private async handleGetPhotoStatus(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const { photoId } = req.params;
      const photo: Photo | null = await this.storageClient.getPhoto(photoId); // Returns Photo or null

      if (!photo) {
        res
          .status(404)
          .json({ error: ErrorCategory.NotFound, message: "Photo not found." });
        return;
      }

      res
        .status(200)
        .json({ photoId: photo.id, status: photo.processing_status }); // Use photo.id and photo.processing_status
    } catch (error: any) {
      console.error("Error getting photo status:", error);
      res.status(500).json({
        error: ErrorCategory.Internal,
        message: error.message || "Internal server error getting photo status.",
      });
    }
  }

  private async handleDeletePhoto(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const { photoId } = req.params;
      const userId = (req.headers["x-user-id"] as string) || "anonymous";

      const photo: Photo | null = await this.storageClient.getPhoto(photoId); // Returns Photo or null
      if (!photo || photo.user_id !== userId) {
        // Check user_id from Photo (can be string or undefined/null)
        // Ensure user owns the photo
        res.status(404).json({
          error: ErrorCategory.NotFound,
          message: "Photo not found or unauthorized.",
        });
        return;
      }

      await this.storageClient.deletePhoto(photoId);
      console.log(`Photo ${photoId} deleted from storage.`);

      // Publish photo.deleted event
      await this.eventBusClient.publish("photo.deleted", { photoId, userId });
      console.log(`Published photo.deleted event for photoId: ${photoId}`);

      res.status(204).send(); // No content on successful deletion
    } catch (error: any) {
      console.error("Error deleting photo:", error);
      res.status(500).json({
        error: ErrorCategory.Internal,
        message: error.message || "Internal server error deleting photo.",
      });
    }
  }

  private async handleDetailedHealth(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    const healthStatus: AggregateHealthStatus = {
      status: "ok", // Default to 'ok'
      timestamp: new Date().toISOString(),
      details: {},
    };

    try {
      const [storagePromise, eventBusPromise, jobQueuePromise] =
        await Promise.allSettled([
          this.storageClient.healthCheck(),
          this.eventBusClient.healthCheck(),
          this.jobCoordinatorClient.getHealth(),
        ]);

      // Storage Health Mapping from StorageCoreHealthStatus to 'ok'/'unavailable'
      if (storagePromise.status === "fulfilled") {
        const storageHealth = storagePromise.value;
        healthStatus.details!.storage = {
          status: storageHealth.service === "healthy" ? "ok" : "unavailable",
          message: `Storage service is ${storageHealth.service}`,
          details: storageHealth,
        };
      } else {
        healthStatus.details!.storage = {
          status: "unavailable",
          message: (storagePromise as PromiseRejectedResult).reason.message,
        };
      }

      // Event Bus Health
      if (eventBusPromise.status === "fulfilled") {
        healthStatus.details!.eventBus = eventBusPromise.value;
      } else {
        const reason = (eventBusPromise as PromiseRejectedResult).reason;
        healthStatus.details!.eventBus = {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          uptime: 0, // Default uptime for unavailable service
          checks: {
            connection: {
              status: "fail",
              message:
                reason instanceof Error ? reason.message : String(reason),
            },
          },
        };
      }

      // Job Queue Health
      if (jobQueuePromise.status === "fulfilled") {
        const jobQueueHealth = jobQueuePromise.value;
        healthStatus.details!.jobQueue = {
          status: jobQueueHealth.status,
          timestamp: new Date(jobQueueHealth.timestamp).toISOString(),
          uptime: 0, // JobQueueHealthStatus does not directly provide uptime
          checks: {
            queues: {
              status:
                jobQueueHealth.queues &&
                jobQueueHealth.queues.every((q: any) => q.status === "ok")
                  ? "pass"
                  : "fail", // Changed to fail if not all are ok
              message: `Queues: ${jobQueueHealth.queues?.length || 0} total, ${
                jobQueueHealth.queues?.filter((q: any) => q.status === "ok")
                  .length || 0
              } healthy`,
              details: {
                queues: jobQueueHealth.queues || [],
              },
            },
            workers: {
              status:
                jobQueueHealth.workers && jobQueueHealth.workers.active > 0
                  ? "pass"
                  : "fail", // Changed to fail if no active workers
              message: `Workers: ${jobQueueHealth.workers?.total || 0} total, ${
                jobQueueHealth.workers?.active || 0
              } active`,
              details: {
                workers: jobQueueHealth.workers || {
                  total: 0,
                  active: 0,
                  paused: 0,
                },
              },
            },
          },
        };
      } else {
        const reason = (jobQueuePromise as PromiseRejectedResult).reason;
        healthStatus.details!.jobQueue = {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          uptime: 0, // Default uptime for unavailable service
          checks: {
            connection: {
              status: "fail",
              message:
                reason instanceof Error ? reason.message : String(reason),
            },
            queues: { status: "fail", message: "Queues unavailable" },
            workers: { status: "fail", message: "Workers unavailable" },
          },
        };
      }

      // Check if any dependency is not 'ok'
      const isStorageOk = healthStatus.details?.storage?.status === "ok";
      // Type assertions are used here because `healthStatus.details?.eventBus`
      // and `healthStatus.details?.jobQueue` might be typed as a generic
      // `HealthStatus` which doesn't directly expose a `status` property.
      const isEventBusOk =
        (healthStatus.details?.eventBus as any)?.status === "healthy";
      const isJobQueueOk =
        (healthStatus.details?.jobQueue as any)?.status === "healthy";

      // WebSocket health metrics
      const websocketHealth = {
        status: 'healthy',
        connectedClients: this.io.engine.clientsCount,
        activeRooms: Object.keys(this.io.sockets.adapter.rooms).length
      };

      // Add WebSocket health to details
      (healthStatus.details as any).websocket = websocketHealth;



      if (!isStorageOk || !isEventBusOk || !isJobQueueOk) {
        healthStatus.status = "degraded";
        healthStatus.message =
          (healthStatus.message ? healthStatus.message + ". " : "") +
          "One or more dependencies are unhealthy.";
      }

      res.status(healthStatus.status === "ok" ? 200 : 503).json(healthStatus);
    } catch (error: any) {
      console.error("Error in detailed health check:", error);
      healthStatus.status = "unavailable";
      healthStatus.message = "Failed to perform detailed health check.";
      healthStatus.error = error.message;
      res.status(503).json(healthStatus);
    }
  }

  private handleNotFound(req: express.Request, res: express.Response): void {
    res.status(404).json({
      error: ErrorCategory.NotFound,
      message: "API endpoint not found.",
    });
  }

  private handleError(
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    console.error("Unhandled API Error:", err);
    let statusCode = 500;
    let errorCategory = ErrorCategory.Internal;
    let message = "An unexpected internal server error occurred.";
    if (err.name === "ValidationError") {
      statusCode = 400;
      errorCategory = ErrorCategory.Validation;
      message = err.message || "Validation failed.";
    } else if (err.name === "UnauthorizedError") {
      statusCode = 401;
      errorCategory = ErrorCategory.Authentication;
      message = "Authentication required or invalid token.";
    } else if (err.name === "ForbiddenError") {
      statusCode = 403;
      errorCategory = ErrorCategory.Authorization;
      message = "Not authorized to access this resource.";
    } else if (err instanceof Error) {
      if (err.message.includes("not found")) {
        statusCode = 404;
        errorCategory = ErrorCategory.NotFound;
        message = err.message;
      } else if (
        err.message.includes("duplicate") ||
        err.message.includes("conflict")
      ) {
        statusCode = 409;
        errorCategory = ErrorCategory.Conflict;
        message = err.message;
      } else if (
        err.message.includes("unavailable") ||
        err.message.includes("service")
      ) {
        statusCode = 503;
        errorCategory = ErrorCategory.ServiceUnavailable;
        message = err.message;
      }
    }
    res.status(statusCode).json({ error: errorCategory, message: message });
  }

  public async start(): Promise<void> {
    const port = process.env.PORT || 3000;
    // Using a Promise to properly await the server listening
    await new Promise<void>((resolve) => {
      this.server.listen(port, () => {
        console.log(`API Gateway service listening on port ${port}`);
        resolve();
      });
    });
  }

  private setupGracefulShutdown(): void {
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received. Initiating graceful shutdown.");
      await this.shutdown();
    });
    process.on("SIGINT", async () => {
      console.log("SIGINT received. Initiating graceful shutdown.");
      await this.shutdown();
    });
  }

  private async shutdown(): Promise<void> {
    console.log("Shutting down API Gateway service...");

    // Notify WebSocket clients
    this.io.emit('system.maintenance', {
      message: 'Server is shutting down for maintenance',
      timestamp: new Date().toISOString()
    });

    // Close Socket.io
    this.io.close();

    // Close HTTP server
    this.server.close(() => {
      console.log("HTTP server closed.");
    });
    // Disconnect from shared infrastructure
    try {
      await this.eventBusClient.disconnect(); // EventBusClient has a disconnect method
      console.log("EventBus disconnected.");
      await this.jobCoordinatorClient.shutdown(); // JobQueueCoordinator has a shutdown method
      console.log("JobCoordinator disconnected.");
      // No explicit shutdown for StorageClient in its public interface currently,
      // assuming it manages its connections internally or on process exit.
      // await this.storageClient.shutdown();
      // console.log('StorageClient disconnected.');
    } catch (error) {
      console.error("Error during shared infrastructure shutdown:", error);
    }
    console.log("API Gateway service shutdown complete. Exiting.");
    process.exit(0);
  }
}
