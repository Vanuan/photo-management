# Processing Subsystem - Complete Design Specification

## Overview

The Processing Subsystem is a **worker-based service** that consumes jobs from BullMQ, fetches photos from MinIO, executes processing pipelines (validation, thumbnails, optimization), stores results, and publishes completion events. Built for scalability, resilience, and extensibility.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PROCESSING SUBSYSTEM                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📥 Job Consumer Layer                                      │
│     ├─ BullMQ Worker Pool                                   │
│     ├─ Job Validation & Deserialization                     │
│     ├─ Priority Queue Management                            │
│     └─ Error Recovery & Retry Logic                         │
│                                                             │
│  ⚙️  Pipeline Orchestrator                                  │
│     ├─ Stage Registry                                       │
│     ├─ Sequential Execution Engine                          │
│     ├─ Progress Tracking                                    │
│     └─ Stage Result Aggregation                             │
│                                                             │
│  🔧 Processing Stages                                       │
│     ├─ Validation Stage                                     │
│     │   ├─ MIME type verification                           │
│     │   ├─ File integrity check                             │
│     │   └─ Dimension validation                             │
│     ├─ Metadata Extraction Stage                            │
│     │   ├─ EXIF data extraction                             │
│     │   ├─ Color space detection                            │
│     │   └─ Format identification                            │
│     ├─ Thumbnail Generation Stage                           │
│     │   ├─ Multi-size generation (150px, 300px, 600px)     │
│     │   ├─ Aspect ratio preservation                        │
│     │   └─ Quality optimization                             │
│     └─ Optimization Stage                                   │
│         ├─ Compression (JPEG/WebP)                          │
│         ├─ Progressive encoding                             │
│         └─ File size reduction                              │
│                                                             │
│  💾 Storage Integration                                     │
│     ├─ MinIO Fetcher (presigned URLs)                       │
│     ├─ Result Uploader (thumbnails, optimized)             │
│     └─ SQLite Metadata Updater                             │
│                                                             │
│  📡 Event Publishing                                        │
│     ├─ Redis Pub/Sub                                        │
│     ├─ Socket.IO Bridge (via API)                           │
│     └─ Progress & Completion Events                         │
│                                                             │
│  🔍 Monitoring & Health                                     │
│     ├─ Worker Health Checks                                 │
│     ├─ Processing Metrics                                   │
│     ├─ Error Tracking                                       │
│     └─ Performance Profiling                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Worker Service Entry Point

```javascript
// src/worker.js
const { Worker } = require('bullmq');
const { Client: MinioClient } = require('minio');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const sharp = require('sharp');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Configuration
const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123'
  },
  storage: {
    bucketName: process.env.MINIO_BUCKET || 'photos'
  },
  database: {
    path: process.env.SQLITE_PATH || './data/photos.db'
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 3,
    maxRetries: parseInt(process.env.WORKER_MAX_RETRIES) || 3
  }
};

// Initialize clients
let db = null;
const minioClient = new MinioClient(config.minio);

// Database connection
async function connectDatabase() {
  db = await open({
    filename: config.database.path,
    driver: sqlite3.Database
  });
  console.log('Worker connected to database');
}

// Main Worker Service
class PhotoProcessingWorker {
  constructor() {
    this.minioClient = minioClient;
    this.bucket = config.storage.bucketName;
    this.worker = null;
    this.isShuttingDown = false;
  }

  async start() {
    await connectDatabase();

    // Create BullMQ Worker
    this.worker = new Worker(
      'photo-processing',
      this.processJob.bind(this),
      {
        connection: config.redis,
        concurrency: config.worker.concurrency,
        limiter: {
          max: 10,      // Max 10 jobs
          duration: 1000 // per second
        },
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1
        }
      }
    );

    // Worker event handlers
    this.worker.on('completed', (job, result) => {
      console.log(`Job ${job.id} completed:`, result);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`Job ${job.id} failed:`, error.message);
    });

    this.worker.on('error', (error) => {
      console.error('Worker error:', error);
    });

    console.log(`Photo Processing Worker started with concurrency ${config.worker.concurrency}`);
  }

  async processJob(job) {
    const { photoId, s3Key, bucket, clientId, sessionId } = job.data;

    console.log(`Processing photo ${photoId}...`);

    try {
      // Update status to processing
      await this.updatePhotoStatus(photoId, 'processing', {
        processing_started_at: new Date().toISOString()
      });

      // Publish processing started event
      await this.publishEvent('photo.processing.started', {
        photoId,
        jobId: job.id,
        clientId,
        sessionId
      });

      // Stage 1: Fetch photo from MinIO (25%)
      await job.updateProgress(10);
      const imageBuffer = await this.fetchPhoto(s3Key);
      await job.updateProgress(25);

      // Stage 2: Validate photo (35%)
      await this.validatePhoto(imageBuffer);
      await job.updateProgress(35);

      // Stage 3: Extract metadata (45%)
      const metadata = await this.extractMetadata(imageBuffer);
      await job.updateProgress(45);

      // Stage 4: Generate thumbnails (75%)
      const thumbnails = await this.generateThumbnails(imageBuffer, photoId);
      await job.updateProgress(75);

      // Stage 5: Optimize original (optional) (90%)
      const optimized = await this.optimizePhoto(imageBuffer);
      await job.updateProgress(90);

      // Stage 6: Update database (95%)
      await this.updatePhotoMetadata(photoId, {
        width: metadata.width,
        height: metadata.height,
        processing_status: 'completed',
        processing_metadata: JSON.stringify({
          thumbnails,
          format: metadata.format,
          colorSpace: metadata.space,
          hasAlpha: metadata.hasAlpha
        }),
        processing_completed_at: new Date().toISOString()
      });
      await job.updateProgress(95);

      // Stage 7: Publish completion event
      await this.publishEvent('photo.processing.completed', {
        photoId,
        jobId: job.id,
        clientId,
        sessionId,
        thumbnails,
        metadata,
        duration: Date.now() - job.timestamp
      });
      await job.updateProgress(100);

      return {
        success: true,
        photoId,
        thumbnailCount: thumbnails.length,
        metadata
      };

    } catch (error) {
      console.error(`Processing failed for ${photoId}:`, error);

      // Update status to failed
      await this.updatePhotoStatus(photoId, 'failed', {
        processing_error: error.message
      });

      // Publish failure event
      await this.publishEvent('photo.processing.failed', {
        photoId,
        jobId: job.id,
        clientId,
        sessionId,
        error: {
          message: error.message,
          code: error.code || 'PROCESSING_ERROR'
        }
      });

      throw error;
    }
  }

  async fetchPhoto(s3Key) {
    try {
      // Generate presigned URL
      const url = await this.minioClient.presignedGetObject(
        this.bucket,
        s3Key,
        3600 // 1 hour expiry
      );

      // Download image
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      return Buffer.from(response.data);

    } catch (error) {
      throw new Error(`Failed to fetch photo: ${error.message}`);
    }
  }

  async validatePhoto(buffer) {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      // Check if valid image
      if (!metadata.format) {
        throw new Error('Invalid image format');
      }

      // Check minimum dimensions
      if (metadata.width < 100 || metadata.height < 100) {
        throw new Error('Image dimensions too small');
      }

      // Check maximum dimensions
      if (metadata.width > 10000 || metadata.height > 10000) {
        throw new Error('Image dimensions too large');
      }

      return true;

    } catch (error) {
      throw new Error(`Validation failed: ${error.message}`);
    }
  }

  async extractMetadata(buffer) {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      return {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
        exif: metadata.exif ? this.parseExif(metadata.exif) : null
      };

    } catch (error) {
      console.warn('Metadata extraction failed:', error.message);
      return null;
    }
  }

  parseExif(exifBuffer) {
    // Simplified EXIF parsing
    // In production, use exif-parser or similar
    try {
      return {
        raw: exifBuffer.toString('base64')
      };
    } catch (error) {
      return null;
    }
  }

  async generateThumbnails(buffer, photoId) {
    const sizes = [
      { name: 'small', width: 150 },
      { name: 'medium', width: 300 },
      { name: 'large', width: 600 }
    ];

    const thumbnails = [];

    for (const size of sizes) {
      try {
        // Generate thumbnail
        const thumbnailBuffer = await sharp(buffer)
          .resize(size.width, size.width, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: 80, progressive: true })
          .toBuffer();

        // Upload to MinIO
        const s3Key = `thumbnails/${photoId}_${size.name}.jpg`;

        await this.minioClient.putObject(
          this.bucket,
          s3Key,
          thumbnailBuffer,
          thumbnailBuffer.length,
          {
            'Content-Type': 'image/jpeg',
            'x-amz-meta-size': size.name,
            'x-amz-meta-photo-id': photoId
          }
        );

        const url = `http://${config.minio.endPoint}:${config.minio.port}/${this.bucket}/${s3Key}`;

        thumbnails.push({
          size: size.name,
          width: size.width,
          s3Key,
          url,
          fileSize: thumbnailBuffer.length
        });

        console.log(`Generated ${size.name} thumbnail for ${photoId}`);

      } catch (error) {
        console.error(`Failed to generate ${size.name} thumbnail:`, error.message);
      }
    }

    return thumbnails;
  }

  async optimizePhoto(buffer) {
    try {
      // Compress image if larger than 2MB
      const originalSize = buffer.length;

      if (originalSize > 2 * 1024 * 1024) {
        const optimizedBuffer = await sharp(buffer)
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();

        const savings = originalSize - optimizedBuffer.length;
        const savingsPercent = ((savings / originalSize) * 100).toFixed(2);

        console.log(`Optimized image: ${savings} bytes saved (${savingsPercent}%)`);

        return {
          optimized: true,
          originalSize,
          optimizedSize: optimizedBuffer.length,
          savings
        };
      }

      return { optimized: false };

    } catch (error) {
      console.warn('Optimization failed:', error.message);
      return { optimized: false, error: error.message };
    }
  }

  async updatePhotoStatus(photoId, status, updates = {}) {
    try {
      const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);

      if (fields) {
        await db.run(`
          UPDATE photos
          SET processing_status = ?, ${fields}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [status, ...values, photoId]);
      } else {
        await db.run(`
          UPDATE photos
          SET processing_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [status, photoId]);
      }

    } catch (error) {
      console.error('Failed to update photo status:', error);
    }
  }

  async updatePhotoMetadata(photoId, metadata) {
    try {
      const fields = Object.keys(metadata).map(key => `${key} = ?`).join(', ');
      const values = Object.values(metadata);

      await db.run(`
        UPDATE photos
        SET ${fields}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [...values, photoId]);

    } catch (error) {
      console.error('Failed to update photo metadata:', error);
    }
  }

  async publishEvent(eventType, data) {
    try {
      // In production, publish to Redis Pub/Sub
      // For now, just log
      console.log(`Event: ${eventType}`, data);

      // Could also call API to broadcast via Socket.IO
      // await axios.post(`${API_URL}/internal/events`, { type: eventType, data });

    } catch (error) {
      console.error('Failed to publish event:', error);
    }
  }

  async shutdown() {
    console.log('Shutting down worker...');
    this.isShuttingDown = true;

    if (this.worker) {
      await this.worker.close();
    }

    if (db) {
      await db.close();
    }

    console.log('Worker shutdown complete');
    process.exit(0);
  }
}

// Start worker
if (require.main === module) {
  const worker = new PhotoProcessingWorker();

  worker.start().catch(error => {
    console.error('Failed to start worker:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => worker.shutdown());
  process.on('SIGINT', () => worker.shutdown());
}

module.exports = PhotoProcessingWorker;
```

---

## Processing Pipeline Stages

### Stage 1: Validation

**Purpose:** Ensure photo is valid and meets quality standards

```javascript
class ValidationStage {
  async execute(buffer, context) {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Format validation
    const validFormats = ['jpeg', 'jpg', 'png', 'webp', 'heic'];
    if (!validFormats.includes(metadata.format)) {
      throw new Error(`Unsupported format: ${metadata.format}`);
    }

    // Dimension validation
    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error('Image too small (min 100x100)');
    }

    if (metadata.width > 10000 || metadata.height > 10000) {
      throw new Error('Image too large (max 10000x10000)');
    }

    // Corruption check
    try {
      await image.toBuffer();
    } catch (error) {
      throw new Error('Image file is corrupted');
    }

    return {
      valid: true,
      format: metadata.format,
      dimensions: { width: metadata.width, height: metadata.height }
    };
  }
}
```

### Stage 2: Metadata Extraction

**Purpose:** Extract EXIF, dimensions, color info

```javascript
class MetadataExtractionStage {
  async execute(buffer, context) {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Extract color statistics
    const stats = await image.stats();

    return {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      space: metadata.space,
      channels: metadata.channels,
      depth: metadata.depth,
      density: metadata.density,
      hasAlpha: metadata.hasAlpha,
      orientation: metadata.orientation,
      isProgressive: metadata.isProgressive,
      chromaSubsampling: metadata.chromaSubsampling,

      // Color statistics
      dominantColor: this.calculateDominantColor(stats),
      brightness: this.calculateBrightness(stats),

      // EXIF data
      exif: metadata.exif ? this.extractExifData(metadata.exif) : null
    };
  }

  calculateDominantColor(stats) {
    // Simplified - take first channel
    const channel = stats.channels[0];
    return {
      r: Math.round(channel.mean),
      g: Math.round(stats.channels[1]?.mean || 0),
      b: Math.round(stats.channels[2]?.mean || 0)
    };
  }

  calculateBrightness(stats) {
    const channel = stats.channels[0];
    return channel.mean / 255; // Normalized 0-1
  }

  extractExifData(exif) {
    // Parse EXIF buffer
    // Use exif-parser or similar library in production
    return {
      raw: exif.toString('base64').substring(0, 100)
    };
  }
}
```

### Stage 3: Thumbnail Generation

**Purpose:** Create multiple thumbnail sizes

```javascript
class ThumbnailGenerationStage {
  constructor(minioClient, bucket) {
    this.minioClient = minioClient;
    this.bucket = bucket;
  }

  async execute(buffer, context) {
    const { photoId } = context;

    const sizes = [
      { name: 'thumb_sm', width: 150, quality: 75 },
      { name: 'thumb_md', width: 300, quality: 80 },
      { name: 'thumb_lg', width: 600, quality: 85 }
    ];

    const thumbnails = [];

    for (const size of sizes) {
      const thumbnail = await this.generateThumbnail(buffer, size, photoId);
      thumbnails.push(thumbnail);
    }

    return { thumbnails };
  }

  async generateThumbnail(buffer, size, photoId) {
    // Create thumbnail
    const thumbnailBuffer = await sharp(buffer)
      .resize(size.width, size.width, {
        fit: 'inside',
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3
      })
      .jpeg({
        quality: size.quality,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();

    // Get actual dimensions
    const thumbMeta = await sharp(thumbnailBuffer).metadata();

    // Upload to MinIO
    const timestamp = Date.now();
    const s3Key = `thumbnails/${photoId}/${size.name}_${timestamp}.jpg`;

    await this.minioClient.putObject(
      this.bucket,
      s3Key,
      thumbnailBuffer,
      thumbnailBuffer.length,
      {
        'Content-Type': 'image/jpeg',
        'x-amz-meta-size': size.name,
        'x-amz-meta-width': size.width.toString(),
        'x-amz-meta-photo-id': photoId
      }
    );

    const url = this.generatePublicUrl(s3Key);

    return {
      name: size.name,
      width: thumbMeta.width,
      height: thumbMeta.height,
      fileSize: thumbnailBuffer.length,
      s3Key,
      url
    };
  }

  generatePublicUrl(s3Key) {
    const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = process.env.MINIO_PORT || 9000;
    return `http://${endpoint}:${port}/${this.bucket}/${s3Key}`;
  }
}
```

### Stage 4: Optimization

**Purpose:** Compress and optimize original photo

```javascript
class OptimizationStage {
  constructor(minioClient, bucket) {
    this.minioClient = minioClient;
    this.bucket = bucket;
  }

  async execute(buffer, context) {
    const { photoId } = context;
    const originalSize = buffer.length;

    // Only optimize if larger than 2MB
    if (originalSize < 2 * 1024 * 1024) {
      return {
        optimized: false,
        reason: 'File already optimal size',
        originalSize
      };
    }

    try {
      // Create optimized version
      const optimizedBuffer = await sharp(buffer)
        .jpeg({
          quality: 85,
          progressive: true,
          mozjpeg: true,
          optimizeCoding: true,
          trellisQuantisation: true,
          overshootDeringing: true
        })
        .toBuffer();

      const optimizedSize = optimizedBuffer.length;
      const savings = originalSize - optimizedSize;
      const savingsPercent = ((savings / originalSize) * 100).toFixed(2);

      // Only upload if significant savings (>10%)
      if (savingsPercent > 10) {
        const s3Key = `photos/optimized/${photoId}_optimized.jpg`;

        await this.minioClient.putObject(
          this.bucket,
          s3Key,
          optimizedBuffer,
          optimizedBuffer.length,
          {
            'Content-Type': 'image/jpeg',
            'x-amz-meta-original-size': originalSize.toString(),
            'x-amz-meta-optimized-size': optimizedSize.toString(),
            'x-amz-meta-savings': savings.toString()
          }
        );

        return {
          optimized: true,
          originalSize,
          optimizedSize,
          savings,
          savingsPercent: parseFloat(savingsPercent),
          s3Key
        };
      }

      return {
        optimized: false,
        reason: 'Savings not significant',
        originalSize,
        optimizedSize,
        savingsPercent: parseFloat(savingsPercent)
      };

    } catch (error) {
      return {
        optimized: false,
        error: error.message
      };
    }
  }
}
```

---

## Worker Configuration

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET=photos

# Database Configuration
SQLITE_PATH=./data/photos.db

# Worker Configuration
WORKER_CONCURRENCY=3
WORKER_MAX_RETRIES=3

# Logging
LOG_LEVEL=info
```

### Docker Compose

```yaml
version: '3.8'

services:
  worker:
    build: ./worker
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin123
      - SQLITE_PATH=/data/photos.db
      - WORKER_CONCURRENCY=3
    volumes:
      - worker-data:/data
    depends_on:
      - redis
      - minio
    deploy:
      replicas: 3
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3

volumes:
  worker-data:
```

---

## Error Handling & Retry Strategy

### Retry Configuration

```javascript
// BullMQ job options
const jobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000  // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 24 * 3600,  // Keep for 24 hours
    count: 1000       // Keep last 1000
  },
  removeOnFail: {
    age: 7 * 24 * 3600  // Keep failed jobs for 7 days
  }
};
```

### Error Classification

```javascript
class ProcessingError extends Error {
  constructor(message, code, retryable = true) {
    super(message);
    this.name = 'ProcessingError';
    this.code = code;
    this.retryable = retryable;
  }
}

// Usage
if (fileCorrupted) {
  throw new ProcessingError(
    'Image file is corrupted',
    'FILE_CORRUPTED',
    false  // Don't retry corrupted files
  );
}

if (minioDown) {
  throw new ProcessingError(
    'Failed to fetch from storage',
    'STORAGE_UNAVAILABLE',
    true  // Retry storage errors
  );
}
```

---

## Monitoring & Metrics

### Worker Health Check

```javascript
class WorkerHealthMonitor {
  constructor(worker) {
    this.worker = worker;
    this.metrics = {
      jobsProcessed: 0,
      jobsFailed: 0,
      averageProcessingTime: 0,
      lastJobTimestamp: null
    };

    this.startMonitoring();
  }

  startMonitoring() {
    this.worker.on('completed', (job, result) => {
      this.metrics.jobsProcessed++;
      this.metrics.lastJobTimestamp = Date.now();
      this.updateAverageTime(Date.now() - job.timestamp);
    });

    this.worker.on('failed', () => {
      this.metrics.jobsFailed++;
    });

    // Health check endpoint (if running HTTP server)
    setInterval(() => {
      this.logMetrics();
    }, 60000);
  }

  updateAverageTime(duration) {
    const alpha = 0.1;  // Exponential moving average
    this.metrics.averageProcessingTime =
      alpha * duration + (1 - alpha) * this.metrics.averageProcessingTime;
  }

  logMetrics() {
    console.log('Worker Metrics:', {
      jobsProcessed: this.metrics.jobsProcessed,
      jobsFailed: this.metrics.jobsFailed,
      successRate: this.calculateSuccessRate(),
      avgProcessingTime: Math.round(this.metrics.averageProcessingTime),
      lastJobAgo: Date.now() - this.metrics.lastJobTimestamp
    });
  }

  calculateSuccessRate() {
    const total = this.metrics.jobsProcessed + this.metrics.jobsFailed;
    if (total === 0) return 0;
    return ((this.metrics.jobsProcessed / total) * 100).toFixed(2);
  }

  getHealth() {
    const timeSinceLastJob = Date.now() - this.metrics.lastJobTimestamp;
    const isHealthy = timeSinceLastJob < 300000; // 5 minutes

    return {
      status: isHealthy ? 'healthy' : 'stale',
      metrics: this.metrics,
      timeSinceLastJob
    };
  }
}
```

---

## Key Features

### Scalability
- Multiple worker instances process jobs concurrently
- BullMQ handles load balancing automatically
- Each worker can process multiple jobs (configured concurrency)

### Resilience
- Automatic retry with exponential backoff
- Failed jobs moved to failed queue for inspection
- Graceful shutdown ensures no job loss

### Observability
- Progress tracking at each stage
- Event publishing for real-time updates
- Comprehensive error logging
- Performance metrics collection

### Extensibility
- Pipeline stages are modular and composable
- Easy to add new processing stages
- Configuration-driven behavior

---

## Integration with API Layer

The Processing Subsystem integrates with the API Layer through:

1. **Job Queue**: API enqueues jobs to BullMQ
2. **Shared Storage**: Both access MinIO and SQLite
3. **Event System**: Workers publish events that API broadcasts via Socket.IO
4. **No Direct Communication**: Clean separation via infrastructure layer

This architecture ensures the Processing Subsystem is independently scalable, testable, and maintainable while providing robust photo processing capabilities for the MVP.
