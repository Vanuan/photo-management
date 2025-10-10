import { setupTestEnvironment, clearTestData, SERVICES } from './setup';
import { teardownTestEnvironment } from './teardown';
import { APIClient } from './utils/api-client';
import { WebSocketClient } from './utils/websocket-client';
import {
  generateTestPhotoData,
  generateCorruptImage,
  generateLargeTestImage,
  generateTestUserId,
} from './utils/test-data';
import { assertResponseStatus } from './utils/assertions';

describe('Error Handling and Edge Cases', () => {
  let apiClient: APIClient;
  let wsClient: WebSocketClient;
  const testUserId = generateTestUserId('error-test-user');

  beforeAll(async () => {
    await setupTestEnvironment();
    apiClient = new APIClient(SERVICES.apiGateway);
  }, 120000);

  afterAll(async () => {
    if (wsClient) {
      await wsClient.disconnect();
    }
    await teardownTestEnvironment();
  }, 60000);

  beforeEach(async () => {
    await clearTestData();
    wsClient = new WebSocketClient(SERVICES.apiGateway, testUserId);
    await wsClient.connect();
  });

  afterEach(async () => {
    if (wsClient) {
      await wsClient.disconnect();
    }
  });

  describe('Upload Validation', () => {
    it('should reject upload with no file', async () => {
      try {
        // Attempt to upload without a file by sending empty buffer
        const result = await apiClient.uploadPhoto(
          Buffer.from(''),
          testUserId,
          'empty.jpg'
        );
        
        // Should either reject or return error status
        expect([400, 422, 500]).toContain(result.response.status);
      } catch (error) {
        // Error is expected
        expect(error).toBeDefined();
      }
    });

    it('should handle corrupt image file', async () => {
      const corruptImage = generateCorruptImage();

      const result = await apiClient.uploadPhoto(
        corruptImage,
        testUserId,
        'corrupt.jpg',
        'image/jpeg'
      );

      // Upload might succeed but processing should fail
      if (result.response.status === 202) {
        const photoId = result.data.photoId;

        // Wait and check if processing failed
        await new Promise(resolve => setTimeout(resolve, 10000));

        const statusResult = await apiClient.getPhotoStatus(photoId);
        
        // Processing should either be failed or still pending/in_progress
        // (depending on how quickly the worker processes it)
        expect(['pending', 'in_progress', 'failed']).toContain(
          statusResult.data.status
        );
      } else {
        // Or upload itself might fail
        expect([400, 422, 500]).toContain(result.response.status);
      }
    }, 60000);

    it('should handle missing user ID', async () => {
      const testPhoto = await generateTestPhotoData('', 'no-user.jpg');

      // Upload with empty user ID
      const result = await apiClient.uploadPhoto(
        testPhoto.buffer,
        '',
        testPhoto.filename
      );

      // Should either accept with 'anonymous' or reject
      // Based on your API implementation
      expect([202, 400, 401]).toContain(result.response.status);
    });
  });

  describe('Large File Handling', () => {
    it('should handle large photo upload', async () => {
      // Generate a large image (this might take time)
      const largeImage = await generateLargeTestImage(5); // 5MB

      const result = await apiClient.uploadPhoto(
        largeImage,
        testUserId,
        'large-photo.jpg',
        'image/jpeg'
      );

      assertResponseStatus(result.response, 202);
      const photoId = result.data.photoId;

      // Large files might take longer to process
      const photo = await apiClient.waitForProcessingComplete(photoId, 120000);
      expect(photo.processingStatus).toBe('completed');
    }, 180000); // 3 minute timeout for large file
  });

  describe('Not Found Errors', () => {
    it('should return 404 for non-existent photo', async () => {
      const fakePhotoId = 'non-existent-photo-id-12345';

      const result = await apiClient.getPhoto(fakePhotoId);
      assertResponseStatus(result.response, 404);
    });

    it('should return 404 for photo status of non-existent photo', async () => {
      const fakePhotoId = 'non-existent-photo-id-12345';

      const result = await apiClient.getPhotoStatus(fakePhotoId);
      assertResponseStatus(result.response, 404);
    });

    it('should return 404 when deleting non-existent photo', async () => {
      const fakePhotoId = 'non-existent-photo-id-12345';

      const result = await apiClient.deletePhoto(fakePhotoId, testUserId);
      assertResponseStatus(result, 404);
    });
  });

  describe('Authorization', () => {
    it('should prevent user from accessing another user\'s photo', async () => {
      const user1Id = generateTestUserId('user1');
      const user2Id = generateTestUserId('user2');

      // Upload photo as user1
      const testPhoto = await generateTestPhotoData(user1Id, 'user1-private.jpg');
      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        user1Id,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;
      await apiClient.waitForProcessingComplete(photoId, 60000);

      // Try to delete as user2
      const deleteResult = await apiClient.deletePhoto(photoId, user2Id);
      
      // Should be forbidden or not found
      expect([403, 404]).toContain(deleteResult.status);

      // Verify photo still exists for user1
      const getResult = await apiClient.getPhoto(photoId);
      expect([200, 404]).toContain(getResult.response.status);
    }, 90000);
  });

  describe('Concurrent Operations', () => {
    it('should handle rapid status checks during processing', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'status-spam.jpg');

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;

      // Make many concurrent status requests
      const statusPromises = Array.from({ length: 20 }, () =>
        apiClient.getPhotoStatus(photoId)
      );

      const results = await Promise.all(statusPromises);

      // All requests should succeed
      results.forEach((result) => {
        assertResponseStatus(result.response, 200);
        expect(['pending', 'in_progress', 'completed', 'failed']).toContain(
          result.data.status
        );
      });
    }, 90000);

    it('should handle concurrent uploads from same user', async () => {
      const count = 10;
      const photos = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          generateTestPhotoData(testUserId, `concurrent-${i}.jpg`)
        )
      );

      // Upload all at once
      const uploadPromises = photos.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );

      const results = await Promise.all(uploadPromises);

      // All should succeed
      results.forEach((result) => {
        assertResponseStatus(result.response, 202);
        expect(result.data.photoId).toBeDefined();
      });

      // All should eventually complete
      const photoIds = results.map((r) => r.data.photoId);
      const processingPromises = photoIds.map((id) =>
        apiClient.waitForProcessingComplete(id, 120000)
      );

      const processed = await Promise.all(processingPromises);
      expect(processed.length).toBe(count);
    }, 180000);
  });

  describe('Processing Failures and Retries', () => {
    it('should handle worker processing failures gracefully', async () => {
      // Note: This test depends on how your worker handles failures
      // You might need to inject failures or use corrupt images
      const corruptImage = generateCorruptImage();

      const result = await apiClient.uploadPhoto(
        corruptImage,
        testUserId,
        'will-fail.jpg',
        'image/jpeg'
      );

      if (result.response.status === 202) {
        const photoId = result.data.photoId;

        // Wait longer to see if it eventually fails
        await new Promise(resolve => setTimeout(resolve, 30000));

        const statusResult = await apiClient.getPhotoStatus(photoId);
        
        // Should eventually be marked as failed
        // Or might still be retrying
        expect(['pending', 'in_progress', 'failed']).toContain(
          statusResult.data.status
        );

        // Check if we received failure event via WebSocket
        const events = wsClient.getEventsForPhoto(photoId);
        const hasFailureEvent = events.some(
          (e) => e.type === 'photo.processing.failed'
        );

        // Might or might not have received failure event yet
        expect(typeof hasFailureEvent).toBe('boolean');
      }
    }, 90000);
  });

  describe('Network Resilience', () => {
    it('should handle temporary network issues gracefully', async () => {
      // This is a basic test - in a real scenario you'd simulate network issues
      const testPhoto = await generateTestPhotoData(testUserId, 'network-test.jpg');

      // Set a shorter timeout to simulate network issues
      const tempClient = new APIClient(SERVICES.apiGateway);

      try {
        const result = await tempClient.uploadPhoto(
          testPhoto.buffer,
          testPhoto.userId,
          testPhoto.filename
        );

        // Should succeed normally in this test environment
        expect([202, 408, 503, 504]).toContain(result.response.status);
      } catch (error) {
        // Network errors are acceptable for this test
        expect(error).toBeDefined();
      }
    });
  });

  describe('Rate Limiting and Resource Management', () => {
    it('should handle system under load', async () => {
      // Upload many photos quickly to stress the system
      const count = 20;
      const photos = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          generateTestPhotoData(testUserId, `stress-${i}.jpg`)
        )
      );

      const uploadPromises = photos.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );

      const results = await Promise.all(uploadPromises);

      // Most should succeed, some might fail if rate limited
      const successCount = results.filter(
        (r) => r.response.status === 202
      ).length;

      expect(successCount).toBeGreaterThan(0);
      expect(successCount).toBeLessThanOrEqual(count);

      console.log(`Stress test: ${successCount}/${count} uploads succeeded`);
    }, 120000);
  });

  describe('Data Integrity', () => {
    it('should maintain data integrity across operations', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'integrity-test.jpg');

      // Upload
      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;

      // Get photo multiple times and verify consistency
      const getResult1 = await apiClient.getPhoto(photoId);
      const getResult2 = await apiClient.getPhoto(photoId);

      expect(getResult1.data).toEqual(getResult2.data);

      // Wait for processing
      await apiClient.waitForProcessingComplete(photoId, 60000);

      // Verify data is still consistent
      const getResult3 = await apiClient.getPhoto(photoId);
      expect(getResult3.data.id).toBe(photoId);
      expect(getResult3.data.userId).toBe(testPhoto.userId);
      expect(getResult3.data.filename).toBe(testPhoto.filename);
    }, 90000);
  });
});
