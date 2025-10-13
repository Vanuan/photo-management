# Storage Layer Usage Guide

The Storage Layer Coordinator is a **`@shared-infra` library** that backend services use to interact with storage systems (SQLite + MinIO) through a unified API.

> 📖 **Detailed Documentation:**
> - [SQLite Layer](./sqlite.md) - Database schema, queries, and operations
> - [MinIO Layer](./minio.md) - Object storage, buckets, and file management  
> - [Architecture Design](./storage-layer-design.md) - Complete technical specification

## 🎯 **Quick Start**

### **Backend Service Usage:**
```typescript
// In your photo-upload API service
import { StorageClient } from '@shared-infra/storage-client';

const storage = new StorageClient({
  storageServiceUrl: 'http://storage-service:3001',
  minioConfig: { /* MinIO config */ }
});

app.post('/photos/upload', async (req, res) => {
  const file = req.file;
  const userId = req.user.id;

  const result = await storage.storePhoto(file.buffer, {
    originalName: file.originalname,
    clientId: userId,
    metadata: {
      uploadedBy: userId,
      uploadTime: new Date()
    }
  });

  res.json({
    success: true,
    photoId: result.id,
    url: result.s3_url
  });
});
```

### **Worker Service Usage:**
```typescript
// In your photo-processing worker
import { StorageClient } from '@shared-infra/storage-client';

const storage = new StorageClient({ /* config */ });

await jobCoordinator.registerWorker('photo-processing', async (job) => {
  const { photoId } = job.data;

  // Get the original photo
  const photo = await storage.getPhoto(photoId);
  
  // Get direct URL for processing
  const photoUrl = await storage.getPhotoUrl(photoId, 3600);

  // Process it (create thumbnails, etc.)
  const processedData = await processImage(photoUrl);

  // Update photo status
  await storage.updatePhotoMetadata(photoId, {
    processing_status: 'completed',
    processing_metadata: JSON.stringify(processedData)
  });
});
```

## 🏗️ **Architecture Overview**

```
┌─────────────────┐         ┌─────────────────┐
│   API Service   │         │  Worker Service │
│   (Node.js)     │         │   (Node.js)     │
└─────────────────┘         └─────────────────┘
         │                            │
         ├─────► Storage Client ◄─────┤
         │       (Shared Library)     │
         ▼                            ▼
┌─────────────────────────────────────────────┐
│           Storage Service                   │
│         (Separate Deployment)               │
│  ┌─────────────┐   ┌─────────────┐         │
│  │   SQLite    │   │    MinIO    │         │
│  │ (Metadata)  │   │ (File Blobs)│         │
│  └─────────────┘   └─────────────┘         │
└─────────────────────────────────────────────┘
```

## 📦 **Core API Methods**

### **Storage Client Interface:**
```typescript
const storage = new StorageClient(config);

// Photo operations
await storage.storePhoto(data, options);        // Store new photo
await storage.getPhoto(photoId);                // Get photo metadata
await storage.getPhotoUrl(photoId);             // Get presigned URL
await storage.deletePhoto(photoId);             // Delete photo

// Search & query
await storage.searchPhotos(query);              // Full-text search
await storage.getUserPhotos(userId, options);   // Get user's photos

// Metadata updates
await storage.updatePhotoMetadata(photoId, metadata);

// Health & diagnostics
await storage.healthCheck();                    // Service status
```

### **Key Features:**
1. **Two-Package Architecture**: Client library + deployable service
2. **Unified API**: Hide SQLite/MinIO complexity behind clean interface
3. **Direct URL Access**: Get presigned URLs without service calls
4. **Built-in Caching**: Automatic metadata and URL caching
5. **Error Handling**: Consistent error types and retry logic
6. **Health Monitoring**: Built-in health checks and metrics

## 🔄 **Deployment Models**

### **Package Structure:**
```
@shared-infra/storage-client     # NPM package for services
@shared-infra/storage-service    # Deployable Docker container  
@shared-infra/storage-core       # Shared functionality
```

### **Development vs Production:**

**Development (Local):**
```bash
# Start storage service locally
docker-compose up storage-service

# Your services connect to localhost:3001
STORAGE_SERVICE_URL=http://localhost:3001
```

**Production (Kubernetes/Docker):**
```bash
# Deploy storage service
kubectl apply -f storage-service-deployment.yaml

# Services connect via service discovery
STORAGE_SERVICE_URL=http://storage-service:3001
```

## 🎯 **Package Comparison**

| Package | Purpose | Deployment | Usage |
|---------|---------|------------|--------|
| **storage-client** | Service integration | NPM install | `import { StorageClient }` |
| **storage-service** | Storage operations | Docker container | HTTP API server |
| **job-queue** | Background jobs | NPM install | `import { JobCoordinator }` |

**Key Difference**: Storage has both a client library AND a separate service, while job-queue is purely a library.

## 📁 **Integration Examples**

### **API Service Setup:**
```typescript
// package.json
{
  "dependencies": {
    "@shared-infra/storage-client": "^1.0.0",
    "@shared-infra/job-queue": "^1.0.0"
  }
}

// src/storage.ts
export const storage = new StorageClient({
  storageServiceUrl: process.env.STORAGE_SERVICE_URL,
  minioConfig: { /* MinIO for direct URLs */ },
  cacheConfig: { enabled: true, ttl: 300 }
});
```

### **Worker Service Setup:**
```typescript
// Same client library, different usage patterns
export class PhotoProcessor {
  async processPhoto(photoId: string) {
    const photo = await storage.getPhoto(photoId);
    const url = await storage.getPhotoUrl(photoId, 3600);
    
    // Process using direct URL...
    
    await storage.updatePhotoMetadata(photoId, {
      processing_status: 'completed'
    });
  }
}
```

### **Development Environment:**
```bash
# Start dependencies
docker-compose up -d minio storage-service

# Install client library
npm install @shared-infra/storage-client

# Your services are ready to use storage
npm run dev
```

## 📋 **Next Steps**

1. **Implementation**: See [storage-layer-design.md](./storage-layer-design.md) for complete technical specs
2. **SQLite Details**: Check [sqlite.md](./sqlite.md) for database schema and queries  
3. **MinIO Setup**: Review [minio.md](./minio.md) for object storage configuration
4. **Examples**: Find code examples in the design document's implementation section
