import { execSync } from "child_process";
import axios from "axios";
import { createClient } from "redis";
import { Client as MinioClient } from "minio";

const SERVICES = {
  apiGateway: process.env.API_GATEWAY_URL || "http://localhost:3000",
  storageService: process.env.STORAGE_SERVICE_URL || "http://localhost:3002",
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
  },
  minio: {
    host: process.env.MINIO_HOST || "localhost",
    port: parseInt(process.env.MINIO_PORT || "9000", 10),
  },
};

const MAX_RETRIES = 30;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Wait for a service to be healthy by checking its health endpoint
 */
async function waitForService(
  url: string,
  maxRetries = MAX_RETRIES,
): Promise<void> {
  console.log(`Waiting for service: ${url}`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(`${url}/health`, {
        timeout: 5000,
        validateStatus: () => true, // Accept any status
      });

      if (response.status === 200 || response.status === 503) {
        console.log(`✓ Service ${url} is responding`);
        return;
      }
    } catch (error) {
      // Service not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  throw new Error(`Service ${url} failed to start after ${maxRetries} retries`);
}

/**
 * Wait for Redis to be ready
 */
async function waitForRedis(
  host: string,
  port: number,
  maxRetries = MAX_RETRIES,
): Promise<void> {
  console.log(`Waiting for Redis at ${host}:${port}`);

  for (let i = 0; i < maxRetries; i++) {
    const client = createClient({
      socket: { host, port },
    });

    try {
      await client.connect();
      await client.ping();
      await client.disconnect();
      console.log("✓ Redis is ready");
      return;
    } catch (error) {
      // Redis not ready yet
      try {
        await client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  throw new Error(`Redis failed to start after ${maxRetries} retries`);
}

/**
 * Wait for MinIO to be ready
 */
async function waitForMinIO(
  host: string,
  port: number,
  maxRetries = MAX_RETRIES,
): Promise<void> {
  console.log(`Waiting for MinIO at ${host}:${port}`);

  const accessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
  const secretKey = process.env.MINIO_SECRET_KEY || "minioadmin";

  const client = new MinioClient({
    endPoint: host,
    port: port,
    useSSL: false,
    accessKey,
    secretKey,
  });

  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.listBuckets();
      console.log("✓ MinIO is ready");
      return;
    } catch (error) {
      console.error(
        `MinIO connection attempt ${i + 1}/${maxRetries} failed:`,
        error,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  throw new Error(`MinIO failed to start after ${maxRetries} retries`);
}

/**
 * Clear all test data from Redis
 */
async function clearRedis(): Promise<void> {
  console.log("Clearing Redis data...");
  const client = createClient({
    socket: { host: SERVICES.redis.host, port: SERVICES.redis.port },
  });

  try {
    await client.connect();
    await client.flushDb();
    console.log("✓ Redis data cleared");
  } finally {
    await client.disconnect();
  }
}

/**
 * Clear all test data from MinIO buckets
 */
async function clearMinIO(): Promise<void> {
  console.log("Clearing MinIO buckets...");
  const accessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
  const secretKey = process.env.MINIO_SECRET_KEY || "minioadmin";

  const client = new MinioClient({
    endPoint: SERVICES.minio.host,
    port: SERVICES.minio.port,
    useSSL: false,
    accessKey,
    secretKey,
  });

  const buckets = ["photos", "thumbnails"];

  for (const bucket of buckets) {
    try {
      const exists = await client.bucketExists(bucket);
      if (exists) {
        const objectsStream = client.listObjects(bucket, "", true);
        const objects: string[] = [];

        for await (const obj of objectsStream) {
          if (obj.name) {
            objects.push(obj.name);
          }
        }

        if (objects.length > 0) {
          await client.removeObjects(bucket, objects);
        }
      }
    } catch (error) {
      console.warn(`Failed to clear bucket ${bucket}:`, error);
    }
  }

  console.log("✓ MinIO buckets cleared");
}

/**
 * Clear SQLite database via Storage Service
 */
async function clearDatabase(): Promise<void> {
  console.log("Clearing SQLite database...");

  try {
    // Delete all photos via API
    // Note: This is a simple approach - in production you might have a dedicated reset endpoint
    const response = await axios.post(
      `${SERVICES.storageService}/api/v1/photos/search`,
      {}, // Empty search query to get all photos
      {
        timeout: 5000,
      },
    );

    // Log the actual response structure for debugging
    console.log(
      "Search API response structure:",
      JSON.stringify(response.data, null, 2),
    );

    // Based on the API response structure from the storage service
    // Response format: { success: true, data: SearchResult, meta: {...} }
    // Where SearchResult has { photos: Photo[], total: number, page: {...}, searchTime: number }
    if (response.data && response.data.success && response.data.data) {
      const photos = response.data.data.photos;
      if (Array.isArray(photos)) {
        console.log(`Found ${photos.length} photos to delete`);
        for (const photo of photos) {
          try {
            await axios.delete(
              `${SERVICES.storageService}/api/v1/photos/${photo.id}`,
            );
            console.log(`Deleted photo ${photo.id}`);
          } catch (deleteError) {
            console.warn(
              `Failed to delete photo ${photo.id}:`,
              deleteError.message,
            );
          }
        }
      } else {
        console.log("No photos array found in response data");
      }
    } else {
      console.log("Unexpected response structure from search API");
      if (response.data) {
        console.log("Response keys:", Object.keys(response.data));
      }
    }

    console.log("✓ Database cleared");
  } catch (error) {
    console.warn("Failed to clear database:", error.message);
    if (error.response) {
      console.warn(
        "Response data:",
        JSON.stringify(error.response.data, null, 2),
      );
    }
  }
}

/**
 * Start all services using docker-compose
 */
function startServices(): void {
  console.log("Starting services (local) ...");
  const commands = [
    "docker compose -f docker-compose.e2e.yml up -d",
    "docker-compose -f docker-compose.e2e.yml up -d",
  ];
  let lastError: any = null;
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
      console.log("✓ Services started");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Failed to start services: ${lastError}`);
}

/**
 * Main setup function for integration tests
 */
export async function setupTestEnvironment(): Promise<void> {
  console.log("=== Setting up test environment ===\n");

  try {
    const manageServices =
      process.env.E2E_MANAGE_SERVICES === "true" && process.env.CI !== "true";
    if (manageServices) {
      startServices();
    } else {
      console.log("Skipping local service start (managed by CI workflow)");
    }

    // Wait for all services to be healthy
    await Promise.all([
      waitForRedis(SERVICES.redis.host, SERVICES.redis.port),
      waitForMinIO(SERVICES.minio.host, SERVICES.minio.port),
    ]);

    // Wait for application services
    await waitForService(SERVICES.storageService);
    await waitForService(SERVICES.apiGateway);

    // Clear any existing test data
    await clearRedis();
    await clearMinIO();
    await clearDatabase();

    console.log("\n=== Test environment ready ===\n");
  } catch (error) {
    console.error("Failed to setup test environment:", error);
    throw error;
  }
}

/**
 * Clear test data between tests
 */
export async function clearTestData(): Promise<void> {
  await Promise.all([clearRedis(), clearMinIO(), clearDatabase()]);
}

// Export service URLs for tests
export { SERVICES };
