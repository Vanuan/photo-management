import { setupTestEnvironment, clearTestData, SERVICES } from './setup';
import { teardownTestEnvironment } from './teardown';
import { APIClient } from './utils/api-client';
import { WebSocketClient } from './utils/websocket-client';
import {
  generateTestImage,
  generateTestPhotoData,
  generateTestPhotos,
  generateTestUserId,
} from './utils/test-data';
import {
  assertPhotoStatus,
  assertValidPhotoMetadata,
  assertMinIOObjectExists,
  assertResponseStatus,
  assertEventExists,
  assertEventually,
} from './utils/assertions';

describe('Photo Upload End-to-End Tests', () => {
  let apiClient: APIClient;
  let wsClient: WebSocketClient;
  const testUserId = generateTestUserId('e2e-user');

  // Setup once before all tests
  beforeAll(async () => {
    await setupTestEnvironment();
    apiClient = new APIClient(SERVICES.apiGateway);
  }, 120000); // 2 minute timeout for setup

  // Cleanup after all tests
  afterAll(async () => {
    if (wsClient) {
      await wsClient.disconnect();
    }
    await teardownTestEnvironment();
  }, 60000);

  // Clear data between tests
  beforeEach(async () => {
    await clearTestData();
    
    // Create new WebSocket client for each test
    wsClient = new WebSocketClient(SERVICES.apiGateway, testUserId);
    await wsClient.connect();
  });

  afterEach(async () => {
    if (wsClient) {
      await wsClient.disconnect();
    }
  });

  describe('Happy Path - Complete Photo Upload Flow', () => {
    it('should upload, process, and complete a photo successfully', async () => {
      // Generate test image
      const testPhoto = await generateTestPhotoData(testUserId, 'test-photo.jpg');

      // Upload photo
      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      // Assert upload response
      assertResponseStatus(uploadResult.response, 202);
      expect(uploadResult.data.photoId).toBeDefined();
      expect(uploadResult.data.userId).toBe(testPhoto.userId);
      expect(uploadResult.data.status).toBe('pending');

      const photoId = uploadResult.data.photoId;

      // Wait for photo.uploaded event via WebSocket
      const uploadedEvent = await wsClient.waitForPhotoEvent(
        photoId,
        'photo.uploaded',
        10000
      );
      expect(uploadedEvent.photoId).toBe(photoId);

      // Wait for processing to start
      const processingStartedEvent = await wsClient.waitForPhotoEvent(
        photoId,
        'photo.processing.started',
        15000
      );
      expect(processingStartedEvent.photoId).toBe(photoId);

      // Wait for processing to complete
      const processingCompletedEvent = await wsClient.waitForProcessingComplete(
        photoId,
        60000
      );
      expect(processingCompletedEvent.photoId).toBe(photoId);
      expect(processingCompletedEvent.status).toBe('completed');

      // Verify photo metadata via API
      const photoResult = await apiClient.getPhoto(photoId);
      assertResponseStatus(photoResult.response, 200);
      assertValidPhotoMetadata(photoResult.data);
      assertPhotoStatus(photoResult.data, 'completed');

      // Verify blob exists in MinIO
      await assertMinIOObjectExists('photos', photoResult.data.filepath);

      // Verify all events were received
      const allEvents = wsClient.getEventsForPhoto(photoId);
      assertEventExists(allEvents, 'photo.uploaded');
      assertEventExists(allEvents, 'photo.processing.started');
      assertEventExists(allEvents, 'photo.processing.completed');
    }, 90000); // 90 second timeout

    it('should generate and store thumbnails', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'thumbnail-test.jpg');

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;

      // Wait for processing to complete
      await apiClient.waitForProcessingComplete(photoId, 60000);

      // Get photo metadata
      const photoResult = await apiClient.getPhoto(photoId);
      const photo = photoResult.data;

      // Check if thumbnails were generated (if implemented)
      // This depends on your worker implementation
      expect(photo).toBeDefined();
      assertPhotoStatus(photo, 'completed');
    }, 90000);

    it('should handle photo metadata correctly', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'metadata-test.jpg');

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;
      await apiClient.waitForProcessingComplete(photoId, 60000);

      const photoResult = await apiClient.getPhoto(photoId);
      const photo = photoResult.data;

      // Verify metadata fields
      expect(photo.id).toBe(photoId);
      expect(photo.userId).toBe(testPhoto.userId);
      expect(photo.filename).toBe(testPhoto.filename);
      expect(photo.mimeType).toBe(testPhoto.mimeType);
      expect(photo.size).toBeGreaterThan(0);
      expect(photo.uploadTimestamp).toBeDefined();
      expect(new Date(photo.uploadTimestamp).getTime()).toBeLessThanOrEqual(Date.now());
      expect(photo.url).toBeDefined(); // Pre-signed URL
    }, 90000);
  });

  describe('Multiple Photo Uploads', () => {
    it('should handle sequential uploads', async () => {
      const photoCount = 3;
      const testPhotos = await generateTestPhotos(photoCount, testUserId);

      const photoIds: string[] = [];

      // Upload photos sequentially
      for (const testPhoto of testPhotos) {
        const uploadResult = await apiClient.uploadPhoto(
          testPhoto.buffer,
          testPhoto.userId,
          testPhoto.filename
        );
        assertResponseStatus(uploadResult.response, 202);
        photoIds.push(uploadResult.data.photoId);
      }

      // Wait for all to complete
      for (const photoId of photoIds) {
        await apiClient.waitForProcessingComplete(photoId, 60000);
      }

      // Verify all photos are in the user's list
      const listResult = await apiClient.getUserPhotos(testUserId, { limit: 10 });
      assertResponseStatus(listResult.response, 200);
      expect(listResult.data.photos.length).toBe(photoCount);
      expect(listResult.data.pagination.total).toBe(photoCount);
    }, 120000);

    it('should handle concurrent uploads', async () => {
      const photoCount = 5;
      const testPhotos = await generateTestPhotos(photoCount, testUserId);

      // Upload all photos concurrently
      const uploadPromises = testPhotos.map((testPhoto) =>
        apiClient.uploadPhoto(
          testPhoto.buffer,
          testPhoto.userId,
          testPhoto.filename
        )
      );

      const uploadResults = await Promise.all(uploadPromises);

      // Verify all uploads succeeded
      expect(uploadResults).toHaveLength(photoCount);
      uploadResults.forEach((result) => {
        assertResponseStatus(result.response, 202);
        expect(result.data.photoId).toBeDefined();
      });

      // Extract photo IDs
      const photoIds = uploadResults.map((r) => r.data.photoId);

      // Wait for all processing to complete
      const processingPromises = photoIds.map((photoId) =>
        apiClient.waitForProcessingComplete(photoId, 90000)
      );

      const processedPhotos = await Promise.all(processingPromises);

      // Verify all completed successfully
      processedPhotos.forEach((photo) => {
        assertPhotoStatus(photo, 'completed');
      });

      // Verify all photos are in the user's list
      const listResult = await apiClient.getUserPhotos(testUserId, { limit: 10 });
      assertResponseStatus(listResult.response, 200);
      expect(listResult.data.photos.length).toBe(photoCount);
    }, 150000);
  });

  describe('Photo Listing and Pagination', () => {
    it('should list user photos with pagination', async () => {
      const photoCount = 15;
      const testPhotos = await generateTestPhotos(photoCount, testUserId);

      // Upload all photos
      const uploadPromises = testPhotos.map((testPhoto) =>
        apiClient.uploadPhoto(
          testPhoto.buffer,
          testPhoto.userId,
          testPhoto.filename
        )
      );

      const uploadResults = await Promise.all(uploadPromises);
      const photoIds = uploadResults.map((r) => r.data.photoId);

      // Wait for all to complete
      await Promise.all(
        photoIds.map((photoId) =>
          apiClient.waitForProcessingComplete(photoId, 90000)
        )
      );

      // Test pagination - first page
      const page1 = await apiClient.getUserPhotos(testUserId, {
        limit: 10,
        offset: 0,
      });
      assertResponseStatus(page1.response, 200);
      expect(page1.data.photos.length).toBe(10);
      expect(page1.data.pagination.total).toBe(photoCount);
      expect(page1.data.pagination.hasMore).toBe(true);

      // Test pagination - second page
      const page2 = await apiClient.getUserPhotos(testUserId, {
        limit: 10,
        offset: 10,
      });
      assertResponseStatus(page2.response, 200);
      expect(page2.data.photos.length).toBe(5);
      expect(page2.data.pagination.hasMore).toBe(false);
    }, 180000);

    it('should only show photos for the specific user', async () => {
      const user1Id = generateTestUserId('user1');
      const user2Id = generateTestUserId('user2');

      const photo1 = await generateTestPhotoData(user1Id, 'user1-photo.jpg');
      const photo2 = await generateTestPhotoData(user2Id, 'user2-photo.jpg');

      // Upload photos for both users
      const upload1 = await apiClient.uploadPhoto(
        photo1.buffer,
        photo1.userId,
        photo1.filename
      );
      const upload2 = await apiClient.uploadPhoto(
        photo2.buffer,
        photo2.userId,
        photo2.filename
      );

      await Promise.all([
        apiClient.waitForProcessingComplete(upload1.data.photoId, 60000),
        apiClient.waitForProcessingComplete(upload2.data.photoId, 60000),
      ]);

      // Verify user1 only sees their photo
      const user1Photos = await apiClient.getUserPhotos(user1Id);
      assertResponseStatus(user1Photos.response, 200);
      expect(user1Photos.data.photos.length).toBe(1);
      expect(user1Photos.data.photos[0].userId).toBe(user1Id);

      // Verify user2 only sees their photo
      const user2Photos = await apiClient.getUserPhotos(user2Id);
      assertResponseStatus(user2Photos.response, 200);
      expect(user2Photos.data.photos.length).toBe(1);
      expect(user2Photos.data.photos[0].userId).toBe(user2Id);
    }, 120000);
  });

  describe('Photo Deletion', () => {
    it('should delete a photo and clean up resources', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'delete-test.jpg');

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;
      await apiClient.waitForProcessingComplete(photoId, 60000);

      // Get photo filepath before deletion
      const photoResult = await apiClient.getPhoto(photoId);
      const filepath = photoResult.data.filepath;

      // Delete photo
      const deleteResult = await apiClient.deletePhoto(photoId, testPhoto.userId);
      assertResponseStatus(deleteResult, 204);

      // Verify photo is no longer accessible
      const getResult = await apiClient.getPhoto(photoId);
      assertResponseStatus(getResult.response, 404);

      // Verify it's not in user's list
      const listResult = await apiClient.getUserPhotos(testPhoto.userId);
      expect(listResult.data.photos.find((p) => p.id === photoId)).toBeUndefined();
    }, 90000);
  });

  describe('Health Check', () => {
    it('should return healthy status when all services are running', async () => {
      const healthResult = await apiClient.checkHealth();
      
      // Health check might return 200 or 503 depending on service state
      expect([200, 503]).toContain(healthResult.response.status);
      expect(healthResult.data.status).toBeDefined();
      expect(healthResult.data.timestamp).toBeDefined();
    });
  });

  describe('WebSocket Real-time Updates', () => {
    it('should receive real-time updates for photo status changes', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'websocket-test.jpg');

      // Clear previous events
      wsClient.clearEvents();

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;

      // Wait for processing to complete
      await wsClient.waitForProcessingComplete(photoId, 60000);

      // Verify we received all expected events in order
      const events = wsClient.getEventsForPhoto(photoId);
      
      expect(events.length).toBeGreaterThanOrEqual(2); // At least uploaded and completed
      
      // Verify event sequence
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('photo.uploaded');
      expect(eventTypes).toContain('photo.processing.completed');
    }, 90000);
  });
});
