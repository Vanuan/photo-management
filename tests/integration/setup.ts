import { execSync } from 'child_process';
import axios from 'axios';
import { createClient } from 'redis';
import { Client as MinioClient } from 'minio';

const SERVICES = {
  apiGateway: 'http://localhost:3000',
  storageService: 'http://localhost:3001',
  redis: { host: 'localhost', port: 6379 },
  minio: { host: 'localhost', port: 9000 },
};

const MAX_RETRIES = 30;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Wait for a service to be healthy by checking its health endpoint
 */
async function waitForService(
  url: string,
  maxRetries = MAX_RETRIES
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
    
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }
  
  throw new Error(`Service ${url} failed to start after ${maxRetries} retries`);
}

/**
 * Wait for Redis to be ready
 */
async function waitForRedis(
  host: string,
  port: number,
  maxRetries = MAX_RETRIES
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
      console.log('✓ Redis is ready');
      return;
    } catch (error) {
      // Redis not ready yet
      try {
        await client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }
  
  throw new Error(`Redis failed to start after ${maxRetries} retries`);
}

/**
 * Wait for MinIO to be ready
 */
async function waitForMinIO(
  host: string,
  port: number,
  maxRetries = MAX_RETRIES
): Promise<void> {
  console.log(`Waiting for MinIO at ${host}:${port}`);
  
  const client = new MinioClient({
    endPoint: host,
    port: port,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  });
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.listBuckets();
      console.log('✓ MinIO is ready');
      return;
    } catch (error) {
      // MinIO not ready yet
    }
    
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
  }
  
  throw new Error(`MinIO failed to start after ${maxRetries} retries`);
}

/**
 * Clear all test data from Redis
 */
async function clearRedis(): Promise<void> {
  console.log('Clearing Redis data...');
  const client = createClient({
    socket: { host: SERVICES.redis.host, port: SERVICES.redis.port },
  });
  
  try {
    await client.connect();
    await client.flushDb();
    console.log('✓ Redis data cleared');
  } finally {
    await client.disconnect();
  }
}

/**
 * Clear all test data from MinIO buckets
 */
async function clearMinIO(): Promise<void> {
  console.log('Clearing MinIO buckets...');
  const client = new MinioClient({
    endPoint: SERVICES.minio.host,
    port: SERVICES.minio.port,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  });
  
  const buckets = ['photos', 'thumbnails'];
  
  for (const bucket of buckets) {
    try {
      const exists = await client.bucketExists(bucket);
      if (exists) {
        const objectsStream = client.listObjects(bucket, '', true);
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
  
  console.log('✓ MinIO buckets cleared');
}

/**
 * Clear SQLite database via Storage Service
 */
async function clearDatabase(): Promise<void> {
  console.log('Clearing SQLite database...');
  
  try {
    // Delete all photos via API
    // Note: This is a simple approach - in production you might have a dedicated reset endpoint
    const response = await axios.get(`${SERVICES.storageService}/photos`, {
      timeout: 5000,
    });
    
    if (response.data && response.data.photos) {
      for (const photo of response.data.photos) {
        await axios.delete(`${SERVICES.storageService}/photos/${photo.id}`);
      }
    }
    
    console.log('✓ Database cleared');
  } catch (error) {
    console.warn('Failed to clear database:', error);
  }
}

/**
 * Start all services using docker-compose
 */
function startServices(): void {
  console.log('Starting services with docker-compose...');
  
  try {
    execSync('docker-compose -f docker-compose.e2e.yml up -d', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('✓ Services started');
  } catch (error) {
    throw new Error(`Failed to start services: ${error}`);
  }
}

/**
 * Main setup function for integration tests
 */
export async function setupTestEnvironment(): Promise<void> {
  console.log('=== Setting up test environment ===\n');
  
  try {
    // Start services
    startServices();
    
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
    
    console.log('\n=== Test environment ready ===\n');
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
}

/**
 * Clear test data between tests
 */
export async function clearTestData(): Promise<void> {
  await Promise.all([
    clearRedis(),
    clearMinIO(),
    clearDatabase(),
  ]);
}

// Export service URLs for tests
export { SERVICES };
