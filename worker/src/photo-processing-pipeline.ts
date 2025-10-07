import sharp from "sharp";
import { StorageCoordinator } from "@shared-infra/storage-client";
import { EventBusService } from "@shared-infra/event-bus";
import config from "./config";

/**
 * @typedef {object} PhotoProcessingJob
 * @property {string} photoId
 * @property {string} userId
 * @property {string} originalFileKey - S3 key for the original uploaded file
 * @property {string} mimeType
 * @property {object} metadata - Initial metadata, if any
 */
export interface PhotoProcessingJobData {
  photoId: string;
  userId: string;
  originalFileKey: string;
  mimeType: string;
  metadata?: object;
}

/**
 * @typedef {object} ProcessingContext
 * @property {string} photoId
 * @property {string} userId
 * @property {string} originalFileKey
 * @property {string} mimeType
 * @property {Buffer | null} imageBuffer - The image data in a buffer, populated by ValidationProcessor
 * @property {object} extractedMetadata - Metadata extracted during processing
 * @property {Array<{size: string, fileKey: string}>} thumbnails - List of generated thumbnails
 * @property {string} optimizedFileKey - S3 key for the optimized original file
 * @property {object} metadata - Initial metadata from the job
 */
export interface ProcessingContext {
  photoId: string;
  userId: string;
  originalFileKey: string;
  mimeType: string;
  imageBuffer: Buffer | null;
  extractedMetadata: object;
  thumbnails: Array<{ size: string; fileKey: string }>;
  optimizedFileKey: string;
  metadata?: object;
}

/**
 * @interface Processor
 * @property {function(ProcessingContext): Promise<ProcessingContext>} execute
 */
interface Processor {
  execute(context: ProcessingContext): Promise<ProcessingContext>;
}

// --- Processing Pipeline Stages ---

class ValidationProcessor implements Processor {
  private storage: StorageCoordinator;

  constructor(storage: StorageCoordinator) {
    this.storage = storage;
  }

  /**
   * Validates the incoming photo data and downloads the image buffer.
   * @param {ProcessingContext} context
   * @returns {Promise<ProcessingContext>}
   */
  async execute(context: ProcessingContext): Promise<ProcessingContext> {
    console.log(`ValidationProcessor: Validating photo ${context.photoId}`);

    const fileExists = await this.storage.fileExists(
      config.storage.s3.bucketName,
      context.originalFileKey,
    );
    if (!fileExists) {
      throw new Error(
        `Original file not found for photoId: ${context.photoId} at ${context.originalFileKey}`,
      );
    }

    if (!context.mimeType.startsWith("image/")) {
      throw new Error(
        `Unsupported MIME type: ${context.mimeType} for photoId: ${context.photoId}`,
      );
    }

    // Download the image to a buffer for subsequent stages
    const imageBuffer = await this.storage.getFile(
      config.storage.s3.bucketName,
      context.originalFileKey,
    );
    context.imageBuffer = imageBuffer;

    // Further sharp-based validation can go here, e.g., checking image dimensions, format
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error(`Image ${context.photoId} has invalid dimensions.`);
    }

    console.log(
      `ValidationProcessor: Photo ${context.photoId} validated successfully.`,
    );
    return context;
  }
}

class MetadataProcessor implements Processor {
  private storage: StorageCoordinator;

  constructor(storage: StorageCoordinator) {
    this.storage = storage;
  }

  /**
   * Extracts metadata from the image using sharp.
   * @param {ProcessingContext} context
   * @returns {Promise<ProcessingContext>}
   */
  async execute(context: ProcessingContext): Promise<ProcessingContext> {
    console.log(
      `MetadataProcessor: Extracting metadata for photo ${context.photoId}`,
    );

    if (!context.imageBuffer) {
      throw new Error("Image buffer not available for metadata extraction.");
    }

    const image = sharp(context.imageBuffer);
    const metadata = await image.metadata();

    // Extract relevant EXIF data (if available)
    let exifData = null;
    if (metadata.exif) {
      // Sharp's metadata.exif is a Buffer, needs conversion or parsing
      // For simplicity, we'll store it as base64 or you might use an exif parsing library
      exifData = metadata.exif.toString("base64");
    }

    // Calculate dominant color
    const { dominant } = await image.stats();
    const dominantColor = dominant
      ? `rgb(${dominant.r},${dominant.g},${dominant.b})`
      : null;

    context.extractedMetadata = {
      ...context.metadata, // Preserve initial metadata
      extractedAt: new Date().toISOString(),
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      space: metadata.space,
      channels: metadata.channels,
      density: metadata.density,
      depth: metadata.depth,
      hasAlpha: metadata.hasAlpha,
      isProgressive: metadata.isProgressive,
      fileSize: context.imageBuffer.length,
      exif: exifData,
      dominantColor,
      // Add more extracted metadata as needed
    };

    console.log(
      `MetadataProcessor: Metadata extracted for photo ${context.photoId}.`,
    );
    return context;
  }
}

class ThumbnailProcessor implements Processor {
  private storage: StorageCoordinator;
  private thumbnailSizes: number[];
  private optimizationQuality: number;

  constructor(storage: StorageCoordinator) {
    this.storage = storage;
    this.thumbnailSizes = config.photoProcessing.thumbnailSizes;
    this.optimizationQuality = config.photoProcessing.optimizationQuality;
  }

  /**
   * Generates thumbnails for the image using sharp.
   * @param {ProcessingContext} context
   * @returns {Promise<ProcessingContext>}
   */
  async execute(context: ProcessingContext): Promise<ProcessingContext> {
    console.log(
      `ThumbnailProcessor: Generating thumbnails for photo ${context.photoId}`,
    );
    context.thumbnails = [];

    if (!context.imageBuffer) {
      throw new Error("Image buffer not available for thumbnail generation.");
    }

    for (const size of this.thumbnailSizes) {
      const thumbnailBuffer = await sharp(context.imageBuffer)
        .resize(size, size, {
          fit: sharp.fit.inside, // Ensure the entire image fits within the bounds
          withoutEnlargement: true, // Don't enlarge if image is smaller than target
        })
        .jpeg({ quality: this.optimizationQuality, progressive: true })
        .toBuffer();

      const thumbnailFileKey = `photos/${context.userId}/${context.photoId}/thumbnail_${size}.jpeg`;

      await this.storage.uploadFile(
        config.storage.s3.bucketName,
        thumbnailFileKey,
        thumbnailBuffer,
        "image/jpeg",
      );
      context.thumbnails.push({
        size: `${size}x${size}`,
        fileKey: thumbnailFileKey,
      });
      console.log(`Generated thumbnail ${size} for ${context.photoId}`);
    }
    console.log(
      `ThumbnailProcessor: Thumbnails generated for photo ${context.photoId}.`,
    );
    return context;
  }
}

class OptimizationProcessor implements Processor {
  private storage: StorageCoordinator;
  private optimizationQuality: number;

  constructor(storage: StorageCoordinator) {
    this.storage = storage;
    this.optimizationQuality = config.photoProcessing.optimizationQuality;
  }

  /**
   * Optimizes the original image using sharp.
   * @param {ProcessingContext} context
   * @returns {Promise<ProcessingContext>}
   */
  async execute(context: ProcessingContext): Promise<ProcessingContext> {
    console.log(
      `OptimizationProcessor: Optimizing original image for photo ${context.photoId}`,
    );

    if (!context.imageBuffer) {
      throw new Error("Image buffer not available for optimization.");
    }

    const optimizedBuffer = await sharp(context.imageBuffer)
      .jpeg({
        quality: this.optimizationQuality,
        progressive: true,
      })
      .toBuffer();

    const optimizedFileKey = `photos/${context.userId}/${context.photoId}/optimized_original.jpeg`;

    await this.storage.uploadFile(
      config.storage.s3.bucketName,
      optimizedFileKey,
      optimizedBuffer,
      "image/jpeg",
    );
    context.optimizedFileKey = optimizedFileKey;
    console.log(
      `OptimizationProcessor: Original image optimized for photo ${context.photoId}.`,
    );
    return context;
  }
}

// --- Photo Processing Pipeline ---

export class PhotoProcessingPipeline {
  private storage: StorageCoordinator;
  private eventBus: EventBusService;
  private processors: Processor[];

  constructor(storage: StorageCoordinator, eventBus: EventBusService) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.processors = [
      new ValidationProcessor(storage),
      new MetadataProcessor(storage),
      new ThumbnailProcessor(storage),
      new OptimizationProcessor(storage),
      // Add more processors here if needed
    ];
  }

  /**
   * Executes the photo processing pipeline.
   * @param {PhotoProcessingJobData} jobData
   * @returns {Promise<object>} Processing result
   */
  async execute(jobData: PhotoProcessingJobData): Promise<object> {
    console.log(
      `PhotoProcessingPipeline: Starting pipeline for photo ${jobData.photoId}`,
    );

    let context: ProcessingContext = {
      photoId: jobData.photoId,
      userId: jobData.userId,
      originalFileKey: jobData.originalFileKey,
      mimeType: jobData.mimeType,
      imageBuffer: null, // Will be populated by ValidationProcessor
      extractedMetadata: {},
      thumbnails: [],
      optimizedFileKey: "",
      metadata: jobData.metadata || {},
    };

    for (const processor of this.processors) {
      context = await processor.execute(context);
    }

    // After all processors, publish an event indicating completion
    const completionEvent = {
      type: "photo.processed",
      timestamp: new Date().toISOString(),
      payload: {
        photoId: context.photoId,
        userId: context.userId,
        originalFileKey: context.originalFileKey,
        optimizedFileKey: context.optimizedFileKey,
        thumbnails: context.thumbnails,
        metadata: context.extractedMetadata,
        status: "completed",
      },
    };
    await this.eventBus.publish(config.eventBus.channel, completionEvent);
    console.log(
      `PhotoProcessingPipeline: Pipeline completed for photo ${jobData.photoId}. Event published.`,
    );

    // Return a summary of the processing result
    return {
      photoId: context.photoId,
      userId: context.userId,
      originalFileKey: context.originalFileKey,
      optimizedFileKey: context.optimizedFileKey,
      thumbnails: context.thumbnails,
      metadata: context.extractedMetadata,
      status: "completed",
    };
  }
}

export {
  PhotoProcessingPipeline,
  ValidationProcessor,
  MetadataProcessor,
  ThumbnailProcessor,
  OptimizationProcessor,
};
