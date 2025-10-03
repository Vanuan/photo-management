#!/usr/bin/env node

/**
 * Storage Layer Example Usage
 *
 * This example demonstrates how to use the Storage Client to interact
 * with the Photo Storage Service for common operations.
 */

const { StorageClient } = require('@shared-infra/storage-client');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  storageServiceUrl: process.env.STORAGE_SERVICE_URL || 'http://localhost:3001',
  minioConfig: {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
  },
  cacheConfig: {
    enabled: true,
    ttl: 300,
    maxSize: 1000
  }
};

async function main() {
  console.log('🚀 Storage Layer Example');
  console.log('========================\n');

  try {
    // Initialize the storage client
    console.log('📦 Initializing Storage Client...');
    const storage = new StorageClient(config);

    // Health check
    console.log('🏥 Checking service health...');
    const isHealthy = await storage.healthCheck();
    if (!isHealthy) {
      throw new Error('Storage service is not healthy');
    }
    console.log('✅ Service is healthy\n');

    // Example 1: Store a photo
    console.log('📸 Example 1: Storing a photo...');
    const demoImage = createDemoImage();

    const storeResult = await storage.storePhoto(demoImage, {
      originalName: 'demo-photo.jpg',
      contentType: 'image/jpeg',
      clientId: 'example-app',
      userId: 'demo-user-123',
      sessionId: 'session-abc',
      metadata: {
        'camera': 'Demo Camera',
        'location': 'Example Location'
      }
    });

    console.log('✅ Photo stored successfully:');
    console.log(`   ID: ${storeResult.id}`);
    console.log(`   Size: ${formatBytes(storeResult.size)}`);
    console.log(`   Bucket: ${storeResult.bucket}`);
    console.log(`   Status: ${storeResult.processing_status}\n`);

    // Example 2: Retrieve photo metadata
    console.log('📋 Example 2: Retrieving photo metadata...');
    const photo = await storage.getPhoto(storeResult.id);

    console.log('✅ Photo metadata retrieved:');
    console.log(`   Original filename: ${photo.original_filename}`);
    console.log(`   MIME type: ${photo.mime_type}`);
    console.log(`   File size: ${formatBytes(photo.file_size)}`);
    console.log(`   Upload date: ${new Date(photo.uploaded_at).toLocaleString()}`);
    console.log(`   Client ID: ${photo.client_id}`);
    console.log(`   User ID: ${photo.user_id}\n`);

    // Example 3: Get presigned URL
    console.log('🔗 Example 3: Getting presigned URL...');
    const url = await storage.getPhotoUrl(storeResult.id, 3600); // 1 hour expiry

    console.log('✅ Presigned URL generated:');
    console.log(`   URL: ${url.substring(0, 80)}...`);
    console.log(`   Expires in: 1 hour\n`);

    // Example 4: Update photo metadata
    console.log('📝 Example 4: Updating photo metadata...');
    await storage.updatePhotoMetadata(storeResult.id, {
      processing_status: 'completed',
      width: 1920,
      height: 1080,
      processing_metadata: JSON.stringify({
        processed_at: new Date().toISOString(),
        filters_applied: ['resize', 'compress'],
        quality: 85
      })
    });

    console.log('✅ Photo metadata updated\n');

    // Example 5: Search photos
    console.log('🔍 Example 5: Searching photos...');
    const searchResults = await storage.searchPhotos({
      filters: {
        user_id: 'demo-user-123',
        mime_type: ['image/jpeg', 'image/png'],
        processing_status: ['completed']
      },
      sort: {
        field: 'uploaded_at',
        order: 'desc'
      },
      limit: 10
    });

    console.log('✅ Search results:');
    console.log(`   Found ${searchResults.total} photos`);
    console.log(`   Search time: ${searchResults.searchTime}ms`);
    searchResults.photos.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.original_filename} (${formatBytes(p.file_size)})`);
    });
    console.log('');

    // Example 6: Get user photos with pagination
    console.log('👤 Example 6: Getting user photos (paginated)...');
    const userPhotos = await storage.getUserPhotos('demo-user-123', {
      limit: 5,
      offset: 0
    });

    console.log('✅ User photos retrieved:');
    console.log(`   Total photos: ${userPhotos.pagination.total}`);
    console.log(`   Showing: ${userPhotos.photos.length} photos`);
    console.log(`   Has more: ${userPhotos.pagination.hasMore}\n`);

    // Example 7: Cache statistics
    console.log('💾 Example 7: Cache statistics...');
    const cacheStats = storage.getCacheStats();

    console.log('✅ Cache statistics:');
    console.log(`   Enabled: ${cacheStats.enabled}`);
    if (cacheStats.enabled) {
      console.log(`   Size: ${cacheStats.size} items`);
      console.log(`   Hit rate: ${(cacheStats.hitRate * 100).toFixed(1)}%`);
    }
    console.log('');

    // Example 8: Bulk operations
    console.log('📦 Example 8: Bulk photo operations...');
    const bulkResults = [];

    for (let i = 1; i <= 3; i++) {
      const imageBuffer = createDemoImage(`demo-${i}`);
      const result = await storage.storePhoto(imageBuffer, {
        originalName: `bulk-photo-${i}.jpg`,
        contentType: 'image/jpeg',
        clientId: 'example-app',
        userId: 'bulk-user',
        metadata: {
          'batch': 'demo-batch',
          'sequence': i.toString()
        }
      });
      bulkResults.push(result);
    }

    console.log(`✅ Stored ${bulkResults.length} photos in bulk`);
    bulkResults.forEach((result, i) => {
      console.log(`   ${i + 1}. ID: ${result.id.substring(0, 8)}...`);
    });
    console.log('');

    // Example 9: Error handling
    console.log('❌ Example 9: Error handling...');
    try {
      await storage.getPhoto('non-existent-photo-id');
    } catch (error) {
      console.log('✅ Properly caught error:');
      console.log(`   Type: ${error.constructor.name}`);
      console.log(`   Message: ${error.message}\n`);
    }

    // Example 10: Cleanup (delete photos)
    console.log('🗑️  Example 10: Cleaning up...');
    const allTestPhotos = [...bulkResults, storeResult];

    for (const photo of allTestPhotos) {
      await storage.deletePhoto(photo.id);
      console.log(`   ✅ Deleted photo: ${photo.id.substring(0, 8)}...`);
    }
    console.log('');

    // Clear cache
    await storage.clearCache();
    console.log('🧹 Cache cleared\n');

    console.log('🎉 All examples completed successfully!');
    console.log('\nNext steps:');
    console.log('- Check the service logs for detailed operation traces');
    console.log('- Visit MinIO console at http://localhost:9001 to see stored files');
    console.log('- Use SQLite browser to inspect the metadata database');
    console.log('- Explore the API documentation for more advanced features');

  } catch (error) {
    console.error('❌ Example failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

function createDemoImage(suffix = '') {
  // Create a simple demo image buffer (fake JPEG header + data)
  const header = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG header
  const data = Buffer.alloc(1024, suffix || 'demo-data');
  const footer = Buffer.from([0xFF, 0xD9]); // JPEG footer

  return Buffer.concat([header, data, footer]);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
  createDemoImage,
  formatBytes
};
