import { PhotoMetadata, PhotoStatusResponse } from './api-client';
import { PhotoEvent } from './websocket-client';
import { Client as MinioClient } from 'minio';
import { createClient } from 'redis';

/**
 * Custom assertion: Photo has expected status
 */
export function assertPhotoStatus(
  photo: PhotoMetadata | PhotoStatusResponse,
  expectedStatus: 'pending' | 'in_progress' | 'completed' | 'failed'
): void {
  const actualStatus = 'processingStatus' in photo ? photo.processingStatus : photo.status;
  
  if (actualStatus !== expectedStatus) {
    throw new Error(
      `Expected photo status to be '${expectedStatus}' but got '${actualStatus}'`
    );
  }
}

/**
 * Custom assertion: Event has expected properties
 */
export function assertEvent(
  event: PhotoEvent,
  expected: Partial<PhotoEvent>
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (event[key as keyof PhotoEvent] !== value) {
      throw new Error(
        `Expected event.${key} to be '${value}' but got '${event[key as keyof PhotoEvent]}'`
      );
    }
  }
}

/**
 * Custom assertion: Event exists in array
 */
export function assertEventExists(
  events: PhotoEvent[],
  eventType: string,
  filter?: (event: PhotoEvent) => boolean
): PhotoEvent {
  const event = events.find(
    (e) => e.type === eventType && (!filter || filter(e))
  );

  if (!event) {
    throw new Error(
      `Expected to find event of type '${eventType}' but none found. Available events: ${events.map((e) => e.type).join(', ')}`
    );
  }

  return event;
}

/**
 * Custom assertion: Photo metadata is valid
 */
export function assertValidPhotoMetadata(photo: PhotoMetadata): void {
  if (!photo.id) {
    throw new Error('Photo metadata missing id');
  }
  if (!photo.userId) {
    throw new Error('Photo metadata missing userId');
  }
  if (!photo.filename) {
    throw new Error('Photo metadata missing filename');
  }
  if (!photo.filepath) {
    throw new Error('Photo metadata missing filepath');
  }
  if (!photo.mimeType) {
    throw new Error('Photo metadata missing mimeType');
  }
  if (typeof photo.size !== 'number' || photo.size <= 0) {
    throw new Error('Photo metadata has invalid size');
  }
  if (!photo.uploadTimestamp) {
    throw new Error('Photo metadata missing uploadTimestamp');
  }
  if (!['pending', 'in_progress', 'completed', 'failed'].includes(photo.processingStatus)) {
    throw new Error(`Photo metadata has invalid processingStatus: ${photo.processingStatus}`);
  }
}

/**
 * Custom assertion: Object exists in MinIO
 */
export async function assertMinIOObjectExists(
  bucket: string,
  objectKey: string,
  minioConfig = {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  }
): Promise<void> {
  const client = new MinioClient(minioConfig);

  try {
    await client.statObject(bucket, objectKey);
  } catch (error: any) {
    throw new Error(
      `Expected object '${objectKey}' to exist in bucket '${bucket}' but it doesn't: ${error.message}`
    );
  }
}

/**
 * Custom assertion: Object does not exist in MinIO
 */
export async function assertMinIOObjectNotExists(
  bucket: string,
  objectKey: string,
  minioConfig = {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  }
): Promise<void> {
  const client = new MinioClient(minioConfig);

  try {
    await client.statObject(bucket, objectKey);
    throw new Error(
      `Expected object '${objectKey}' to NOT exist in bucket '${bucket}' but it does`
    );
  } catch (error: any) {
    // If error is "Not Found", that's what we expect
    if (error.code !== 'NotFound') {
      throw error;
    }
  }
}

/**
 * Custom assertion: Redis key exists
 */
export async function assertRedisKeyExists(
  key: string,
  redisConfig = { host: 'localhost', port: 6379 }
): Promise<void> {
  const client = createClient({
    socket: redisConfig,
  });

  try {
    await client.connect();
    const exists = await client.exists(key);
    
    if (!exists) {
      throw new Error(`Expected Redis key '${key}' to exist but it doesn't`);
    }
  } finally {
    await client.disconnect();
  }
}

/**
 * Custom assertion: Photo has thumbnails
 */
export function assertPhotoHasThumbnails(
  photo: PhotoMetadata,
  expectedCount: number = 3
): void {
  if (!('thumbnails' in photo) || !(photo as any).thumbnails) {
    throw new Error('Photo metadata does not have thumbnails property');
  }

  const thumbnails = (photo as any).thumbnails;
  
  if (!Array.isArray(thumbnails)) {
    throw new Error('Photo thumbnails is not an array');
  }

  if (thumbnails.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} thumbnails but got ${thumbnails.length}`
    );
  }
}

/**
 * Custom assertion: Response has status code
 */
export function assertResponseStatus(
  response: { status: number },
  expectedStatus: number
): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected response status ${expectedStatus} but got ${response.status}`
    );
  }
}

/**
 * Custom assertion: Time is within range
 */
export function assertTimeWithinRange(
  timestamp: string,
  maxAgeMs: number = 5000
): void {
  const time = new Date(timestamp).getTime();
  const now = Date.now();
  const age = now - time;

  if (age > maxAgeMs || age < 0) {
    throw new Error(
      `Expected timestamp to be within ${maxAgeMs}ms but it was ${age}ms ago`
    );
  }
}

/**
 * Custom assertion: Array has length
 */
export function assertArrayLength<T>(
  array: T[],
  expectedLength: number,
  message?: string
): void {
  if (array.length !== expectedLength) {
    throw new Error(
      message ||
        `Expected array to have length ${expectedLength} but got ${array.length}`
    );
  }
}

/**
 * Custom assertion: Value is in range
 */
export function assertInRange(
  value: number,
  min: number,
  max: number,
  name: string = 'Value'
): void {
  if (value < min || value > max) {
    throw new Error(
      `${name} ${value} is not in range [${min}, ${max}]`
    );
  }
}

/**
 * Wait for condition to be true
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 500,
  errorMessage: string = 'Condition not met within timeout'
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(errorMessage);
}

/**
 * Assert eventually (retry until condition is met or timeout)
 */
export async function assertEventually(
  assertion: () => void | Promise<void>,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 500
): Promise<void> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await assertion();
      return; // Assertion passed
    } catch (error) {
      lastError = error as Error;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(
    `Assertion failed after ${timeoutMs}ms. Last error: ${lastError?.message}`
  );
}
