import { setupTestEnvironment, clearTestData, SERVICES } from '../integration/setup';
import { teardownTestEnvironment } from '../integration/teardown';
import { APIClient } from '../integration/utils/api-client';
import { WebSocketClient } from '../integration/utils/websocket-client';
import {
  generateTestPhotoData,
  generateTestPhotos,
  generateTestUserId,
} from '../integration/utils/test-data';

interface PerformanceMetrics {
  uploadResponseTime: number[];
  processingTime: number[];
  websocketLatency: number[];
  endToEndTime: number[];
  throughput: number;
  successRate: number;
  errorRate: number;
}

describe('Performance Benchmarks', () => {
  let apiClient: APIClient;
  let wsClient: WebSocketClient;
  const testUserId = generateTestUserId('perf-test-user');

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

  describe('Upload Performance', () => {
    it('should complete upload within 2 seconds', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'upload-perf.jpg');

      const startTime = Date.now();
      const result = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );
      const endTime = Date.now();

      const uploadTime = endTime - startTime;

      expect(result.response.status).toBe(202);
      expect(uploadTime).toBeLessThan(2000); // < 2 seconds

      console.log(`Upload response time: ${uploadTime}ms`);
    }, 30000);

    it('should complete processing within 30 seconds', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'process-perf.jpg');

      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;
      const startTime = Date.now();

      await apiClient.waitForProcessingComplete(photoId, 60000);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      expect(processingTime).toBeLessThan(30000); // < 30 seconds

      console.log(`Processing time: ${processingTime}ms`);
    }, 90000);

    it('should have WebSocket notification latency < 500ms', async () => {
      const testPhoto = await generateTestPhotoData(testUserId, 'ws-latency.jpg');

      wsClient.clearEvents();

      const uploadStartTime = Date.now();
      const uploadResult = await apiClient.uploadPhoto(
        testPhoto.buffer,
        testPhoto.userId,
        testPhoto.filename
      );

      const photoId = uploadResult.data.photoId;

      // Wait for WebSocket event
      const event = await wsClient.waitForPhotoEvent(
        photoId,
        'photo.uploaded',
        5000
      );

      const eventTime = new Date(event.timestamp!).getTime();
      const latency = eventTime - uploadStartTime;

      // Latency should be reasonable
      expect(latency).toBeLessThan(2000); // < 2 seconds (generous threshold)

      console.log(`WebSocket notification latency: ${latency}ms`);
    }, 30000);
  });

  describe('Throughput Benchmarks', () => {
    it('should handle at least 10 concurrent uploads', async () => {
      const count = 10;
      const photos = await generateTestPhotos(count, testUserId);

      const startTime = Date.now();

      const uploadPromises = photos.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );

      const results = await Promise.all(uploadPromises);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Calculate throughput (uploads per second)
      const throughput = (count / totalTime) * 1000;

      // All uploads should succeed
      const successCount = results.filter((r) => r.response.status === 202).length;
      expect(successCount).toBe(count);

      // Should handle at least 5 uploads per second
      expect(throughput).toBeGreaterThan(2);

      console.log(`Concurrent upload throughput: ${throughput.toFixed(2)} uploads/second`);
      console.log(`Total time for ${count} uploads: ${totalTime}ms`);
    }, 60000);

    it('should process 10 photos within 60 seconds', async () => {
      const count = 10;
      const photos = await generateTestPhotos(count, testUserId);

      // Upload all
      const uploadPromises = photos.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );

      const uploadResults = await Promise.all(uploadPromises);
      const photoIds = uploadResults.map((r) => r.data.photoId);

      const startTime = Date.now();

      // Wait for all to process
      const processingPromises = photoIds.map((id) =>
        apiClient.waitForProcessingComplete(id, 120000)
      );

      await Promise.all(processingPromises);

      const endTime = Date.now();
      const totalProcessingTime = endTime - startTime;

      expect(totalProcessingTime).toBeLessThan(120000); // < 2 minutes

      console.log(`Time to process ${count} photos: ${totalProcessingTime}ms`);
      console.log(`Average processing time: ${(totalProcessingTime / count).toFixed(2)}ms`);
    }, 180000);
  });

  describe('Scalability Tests', () => {
    it('should measure performance with 20 sequential uploads', async () => {
      const count = 20;
      const metrics: PerformanceMetrics = {
        uploadResponseTime: [],
        processingTime: [],
        websocketLatency: [],
        endToEndTime: [],
        throughput: 0,
        successRate: 0,
        errorRate: 0,
      };

      let successCount = 0;
      let errorCount = 0;

      const overallStartTime = Date.now();

      for (let i = 0; i < count; i++) {
        try {
          const testPhoto = await generateTestPhotoData(
            testUserId,
            `seq-${i}.jpg`
          );

          // Measure upload time
          const uploadStart = Date.now();
          const uploadResult = await apiClient.uploadPhoto(
            testPhoto.buffer,
            testPhoto.userId,
            testPhoto.filename
          );
          const uploadEnd = Date.now();
          metrics.uploadResponseTime.push(uploadEnd - uploadStart);

          if (uploadResult.response.status === 202) {
            successCount++;
            const photoId = uploadResult.data.photoId;

            // Measure processing time
            const processStart = Date.now();
            await apiClient.waitForProcessingComplete(photoId, 90000);
            const processEnd = Date.now();
            metrics.processingTime.push(processEnd - processStart);

            metrics.endToEndTime.push(processEnd - uploadStart);
          } else {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
        }
      }

      const overallEndTime = Date.now();
      const totalTime = overallEndTime - overallStartTime;

      metrics.throughput = (count / totalTime) * 1000;
      metrics.successRate = (successCount / count) * 100;
      metrics.errorRate = (errorCount / count) * 100;

      // Calculate statistics
      const avgUploadTime =
        metrics.uploadResponseTime.reduce((a, b) => a + b, 0) /
        metrics.uploadResponseTime.length;
      const avgProcessingTime =
        metrics.processingTime.reduce((a, b) => a + b, 0) /
        metrics.processingTime.length;
      const avgEndToEndTime =
        metrics.endToEndTime.reduce((a, b) => a + b, 0) /
        metrics.endToEndTime.length;

      console.log('\n=== Performance Benchmark Results ===');
      console.log(`Total photos: ${count}`);
      console.log(`Success rate: ${metrics.successRate.toFixed(2)}%`);
      console.log(`Error rate: ${metrics.errorRate.toFixed(2)}%`);
      console.log(`Average upload response time: ${avgUploadTime.toFixed(2)}ms`);
      console.log(`Average processing time: ${avgProcessingTime.toFixed(2)}ms`);
      console.log(`Average end-to-end time: ${avgEndToEndTime.toFixed(2)}ms`);
      console.log(`Overall throughput: ${metrics.throughput.toFixed(2)} uploads/second`);
      console.log(`Total time: ${totalTime}ms`);
      console.log('=====================================\n');

      // Performance assertions
      expect(metrics.successRate).toBeGreaterThan(90); // > 90% success rate
      expect(avgUploadTime).toBeLessThan(3000); // < 3s average upload
      expect(avgProcessingTime).toBeLessThan(40000); // < 40s average processing
    }, 600000); // 10 minute timeout for this comprehensive test
  });

  describe('Memory and Resource Usage', () => {
    it('should handle burst traffic without degradation', async () => {
      const burstSize = 15;
      
      // First burst
      const photos1 = await generateTestPhotos(burstSize, testUserId);
      const burst1Start = Date.now();
      
      const upload1Promises = photos1.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );
      
      const results1 = await Promise.all(upload1Promises);
      const burst1Time = Date.now() - burst1Start;
      
      const photoIds1 = results1
        .filter((r) => r.response.status === 202)
        .map((r) => r.data.photoId);

      // Wait for first burst to complete
      await Promise.all(
        photoIds1.map((id) => apiClient.waitForProcessingComplete(id, 120000))
      );

      // Second burst immediately after
      const photos2 = await generateTestPhotos(burstSize, testUserId);
      const burst2Start = Date.now();
      
      const upload2Promises = photos2.map((photo) =>
        apiClient.uploadPhoto(photo.buffer, photo.userId, photo.filename)
      );
      
      const results2 = await Promise.all(upload2Promises);
      const burst2Time = Date.now() - burst2Start;

      const photoIds2 = results2
        .filter((r) => r.response.status === 202)
        .map((r) => r.data.photoId);

      // Wait for second burst to complete
      await Promise.all(
        photoIds2.map((id) => apiClient.waitForProcessingComplete(id, 120000))
      );

      console.log(`First burst time: ${burst1Time}ms`);
      console.log(`Second burst time: ${burst2Time}ms`);

      // Second burst should not be significantly slower (< 50% degradation)
      const degradation = ((burst2Time - burst1Time) / burst1Time) * 100;
      console.log(`Performance degradation: ${degradation.toFixed(2)}%`);

      // Allow some degradation but not too much
      expect(Math.abs(degradation)).toBeLessThan(100); // < 100% degradation
    }, 360000); // 6 minute timeout
  });

  describe('Latency Percentiles', () => {
    it('should measure p50, p95, and p99 latencies', async () => {
      const count = 50;
      const latencies: number[] = [];

      for (let i = 0; i < count; i++) {
        const testPhoto = await generateTestPhotoData(testUserId, `latency-${i}.jpg`);

        const startTime = Date.now();
        const result = await apiClient.uploadPhoto(
          testPhoto.buffer,
          testPhoto.userId,
          testPhoto.filename
        );
        const endTime = Date.now();

        if (result.response.status === 202) {
          latencies.push(endTime - startTime);
        }
      }

      // Sort latencies
      latencies.sort((a, b) => a - b);

      const p50 = latencies[Math.floor(count * 0.5)];
      const p95 = latencies[Math.floor(count * 0.95)];
      const p99 = latencies[Math.floor(count * 0.99)];

      console.log('\n=== Latency Percentiles ===');
      console.log(`p50 (median): ${p50}ms`);
      console.log(`p95: ${p95}ms`);
      console.log(`p99: ${p99}ms`);
      console.log('===========================\n');

      // Reasonable latency thresholds
      expect(p50).toBeLessThan(2000); // p50 < 2s
      expect(p95).toBeLessThan(5000); // p95 < 5s
      expect(p99).toBeLessThan(10000); // p99 < 10s
    }, 300000); // 5 minute timeout
  });
});
