# Photo Processing Worker Service

This service is responsible for processing uploaded photos, including validation, metadata extraction, thumbnail generation, and optimization. It leverages a job queue for asynchronous processing and interacts with a storage service for file operations and an event bus for communication.

## Architecture

The worker service is built upon a modular architecture, consisting of:

- **WorkerService**: The main entry point that initializes and manages the job queue, storage, and event bus connections. It orchestrates the processing of jobs.
- **PhotoProcessingPipeline**: A central component that defines and executes a series of processing stages (processors) for each photo.
- **Processing Stages (Processors)**: Individual, focused modules responsible for a specific task in the photo processing workflow (e.g., `ValidationProcessor`, `MetadataProcessor`, `ThumbnailProcessor`, `OptimizationProcessor`).

## Core Components

### 1. Worker Service Entry Point (`src/index.js`)

The `WorkerService` class acts as the orchestrator. It sets up the BullMQ worker to consume jobs from a designated queue and delegates the actual photo processing to the `PhotoProcessingPipeline`. It also handles graceful shutdown.

### 2. Configuration (`src/config.js`)

All service configurations, including Redis connection details, S3 (MinIO) settings, event bus channel, and photo processing parameters (like thumbnail sizes), are managed in `src/config.js`. This allows for easy environment-specific adjustments.

### 3. Processing Pipeline (`src/photo-processing-pipeline.js`)

The `PhotoProcessingPipeline` coordinates the execution of individual processing stages. It takes a `PhotoProcessingJob` as input, passes it through each processor, and publishes a `photo.processed` event upon successful completion.

## Processing Pipeline Stages

Each stage is a dedicated processor with a single responsibility:

- **ValidationProcessor**: Ensures the uploaded photo is valid (e.g., file exists, correct MIME type).
- **MetadataProcessor**: Extracts technical and descriptive metadata from the image (e.g., EXIF data, dimensions, dominant color).
- **ThumbnailProcessor**: Generates various sizes of thumbnails for the processed photo.
- **OptimizationProcessor**: Optimizes the original image for web delivery (e.g., compression, format conversion).

## Dependencies

The worker service relies on several shared infrastructure components:

- `@shared-infra/job-queue`: For managing and consuming jobs from the BullMQ queue.
- `@shared-infra/storage-client`: For interacting with the S3-compatible object storage (MinIO).
- `@shared-infra/event-bus`: For publishing and subscribing to events via Redis.
- `sharp`: A high-performance Node.js image processing library used for resizing, optimizing, and extracting metadata from images.

## Environment Variables

The service can be configured using the following environment variables:

- `NODE_ENV`: Application environment (e.g., `development`, `production`).
- `REDIS_HOST`: Host for the Redis instance (used by Job Queue and Event Bus).
- `REDIS_PORT`: Port for the Redis instance.
- `JOB_QUEUE_NAME`: Name of the BullMQ queue to consume jobs from.
- `JOB_WORKER_CONCURRENCY`: Number of concurrent jobs the worker can process.
- `JOB_ATTEMPTS`: Number of retry attempts for failed jobs.
- `JOB_BACKOFF_TYPE`: Backoff strategy for retries (e.g., `exponential`, `fixed`).
- `JOB_BACKOFF_DELAY`: Delay in milliseconds for job retries.
- `MINIO_ENDPOINT`: Endpoint for the MinIO/S3 compatible storage.
- `MINIO_ACCESS_KEY`: Access key for MinIO/S3.
- `MINIO_SECRET_KEY`: Secret key for MinIO/S3.
- `S3_BUCKET_NAME`: Name of the S3 bucket where photos are stored.
- `S3_SSL_ENABLED`: Whether to use SSL for S3 connection (`true` or `false`).
- `S3_FORCE_PATH_STYLE`: Force path style for S3 (`true` or `false`, typically `true` for MinIO).
- `EVENT_BUS_CHANNEL`: Redis channel name for event bus communication.
- `THUMBNAIL_SIZES`: Comma-separated list of thumbnail sizes (e.g., `150,300,600`).
- `OPTIMIZATION_QUALITY`: JPEG compression quality (0-100) for optimized images.

## Getting Started

### Prerequisites

- Node.js (v20 or later)
- npm
- Docker (for containerized deployment)
- Redis instance
- MinIO/S3 compatible storage

### Local Development

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Configure Environment:** Create a `.env` file in the root of the `worker` directory based on the environment variables listed above.
3.  **Start the Worker:**
    ```bash
    npm run dev
    ```
    This will start the worker in development mode with `nodemon` for auto-reloading.

### Docker Deployment

1.  **Build the Docker image:**
    ```bash
    docker build -t photo-processing-worker .
    ```
2.  **Run the container:**
    ```bash
    docker run -d --name photo-worker -p 8080:8080 \
      -e REDIS_HOST=your_redis_host \
      -e MINIO_ENDPOINT=your_minio_endpoint \
      # ... other environment variables
      photo-processing-worker
    ```

### Testing

Run unit and integration tests:

```bash
npm test
```
