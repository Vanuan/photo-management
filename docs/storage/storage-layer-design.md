# Storage Layer Architecture - Design Document

This document outlines the high-level architecture and design decisions for the Storage Layer system.

> 📖 **Detailed Implementation:**
> - [SQLite Documentation](./sqlite.md) - Database schema, operations, and optimization
> - [MinIO Documentation](./minio.md) - Object storage, buckets, and file management
> - [Usage Guide](./usage.md) - Quick start and integration examples

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Package Structure](#2-package-structure)
- [3. Design Philosophy](#3-design-philosophy)
- [4. Component Interactions](#4-component-interactions)
- [5. Data Flow](#5-data-flow)
- [6. Deployment Strategy](#6-deployment-strategy)
- [7. Configuration Management](#7-configuration-management)
- [8. Testing Strategy](#8-testing-strategy)

---

## 1. Architecture Overview

### 1.1 Design Philosophy

The Storage Layer follows a **dual-package architecture** with clear separation of concerns:

- **Storage Client Library** (`@shared-infra/storage-client`): Lightweight client for service integration
- **Storage Service** (`@shared-infra/storage-service`): Deployable service handling storage operations
- **Storage Core** (`@shared-infra/storage-core`): Shared business logic and data models

**Key Principles:**
- **Service Independence**: Storage service can be scaled/deployed separately
- **Client Simplicity**: Services use a clean, consistent API
- **Direct Access**: Client can bypass service for performance-critical operations (presigned URLs)
- **Fault Tolerance**: Built-in retries, caching, and error handling

### 1.2 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                            │
│                                                                     │
│  ┌─────────────────┐              ┌─────────────────┐              │
│  │   API Service   │              │  Worker Service │              │
│  │   (Node.js)     │              │   (Node.js)     │              │
│  └─────────────────┘              └─────────────────┘              │
│           │                                 │                      │
│           └─────────────────┬───────────────┘                      │
│                             │                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              STORAGE CLIENT LIBRARY                             │ │
│  │                                                                 │ │
│  │  • Simple API Interface    • Caching Layer                     │ │
│  │  • Direct MinIO Access     • Retry Logic                       │ │
│  │  • Service Communication   • Error Handling                    │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                             │ HTTP/REST                            │
│                             ▼                                      │
├─────────────────────────────────────────────────────────────────────┤
│                      STORAGE SERVICE                                │
│                    (Separate Deployment)                           │
│                                                                     │
│  ┌─────────────────┐              ┌─────────────────┐              │
│  │  REST API       │              │ Storage Core    │              │
│  │  • Photo CRUD   │              │ • MinIO Client  │              │
│  │  • Search       │              │ • SQLite DB     │              │
│  │  • Admin Ops    │              │ • Transactions  │              │
│  │  • Health Check │              │ • Consistency   │              │
│  └─────────────────┘              └─────────────────┘              │
│           │                                 │                      │
│           └─────────────────┬───────────────┘                      │
│                             │                                      │
│  ┌─────────────────┐       │       ┌─────────────────┐             │
│  │     MinIO       │       │       │     SQLite      │             │
│  │  (File Store)   │◄──────┼──────►│   (Metadata)    │             │
│  │  • Buckets      │       │       │  • Photos       │             │
│  │  • Presigned    │       │       │  • Thumbnails   │             │
│  │  • Multipart    │       │       │  • Processing   │             │
│  └─────────────────┘       │       └─────────────────┘             │
│                             ▼                                      │
│                    ┌─────────────────┐                             │
│                    │   Monitoring    │                             │
│                    │   & Metrics     │                             │
│                    └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Package Overview

| Package | Purpose | Deployment | Dependencies |
|---------|---------|------------|--------------|
| **@shared-infra/storage-client** | Client library for services | NPM package | minio, axios |
| **@shared-infra/storage-service** | Deployable storage service | Docker container | express, storage-core |
| **@shared-infra/storage-core** | Shared functionality | Internal dependency | sqlite3, minio |

---

## 2. Package Structure

### 2.1 Directory Structure

```
shared-infra/
├── packages/
│   ├── storage-client/           # Client library package
│   │   ├── src/
│   │   │   ├── client.ts         # Main StorageClient class
│   │   │   ├── types.ts          # Type definitions
│   │   │   ├── cache.ts          # Caching layer
│   │   │   └── index.ts          # Public API
│   │   └── package.json
│   │
│   ├── storage-service/          # Deployable service
│   │   ├── src/
│   │   │   ├── server.ts         # Express server
│   │   │   ├── routes/           # API routes
│   │   │   └── middleware/       # Express middleware
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── storage-core/             # Shared core functionality
│       ├── src/
│       │   ├── coordinator.ts    # Storage coordinator
│       │   ├── minio-client.ts   # MinIO operations
│       │   ├── sqlite-client.ts  # SQLite operations
│       │   └── types.ts          # Shared types
│       ├── migrations/           # Database migrations
│       └── package.json
│
├── docker-compose.yml            # Development environment
└── package.json                  # Root workspace config
```

### 2.2 Package Dependencies

```json
{
  "name": "@shared-infra/storage",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "docker:build": "docker build -t storage-service packages/storage-service"
  }
}
```

---

## 3. Design Philosophy

### 3.1 Why Two Packages?

**Client Library Benefits:**
- Lightweight dependency for consuming services
- Direct MinIO access for presigned URLs (performance)
- Built-in caching and retry logic
- Consistent error handling across services

**Separate Service Benefits:**
- Centralized storage logic and consistency management
- Independent scaling and deployment
- Resource isolation (SQLite connections, memory)
- Easier monitoring and maintenance

### 3.2 Data Storage Strategy

**SQLite for Metadata:**
- Structured queries and relationships
- ACID transactions
- Full-text search capabilities
- Lightweight, embedded database

**MinIO for Blobs:**
- S3-compatible object storage
- Scalable file storage
- Presigned URL support
- Built-in redundancy and backup

---

## 4. Component Interactions

```typescript
// @shared-infra/storage-client/src/client.ts

### 4.1 Storage Client → Service Communication

```
Service (API/Worker)
    ↓ (imports)
StorageClient Library
    ↓ (HTTP/REST)
Storage Service
    ↓ (coordinates)
SQLite + MinIO
```

**Flow Patterns:**
1. **Store Photo**: Client → Service → SQLite + MinIO
2. **Get Metadata**: Client → Service → SQLite (with caching)
3. **Get File URL**: Client → MinIO directly (presigned URLs)
4. **Search**: Client → Service → SQLite FTS

### 4.2 Direct Access Pattern

For performance-critical operations, the client can bypass the service:

```typescript
// Direct MinIO access for file URLs
const url = await storage.getPhotoUrl(photoId); // Bypasses service

// Service access for metadata operations
const metadata = await storage.getPhoto(photoId); // Through service
```

### 4.3 Caching Strategy

**Client-Side Caching:**
- Photo metadata (5-minute TTL)
- Presigned URLs (with expiry tracking)
- Search results (short-lived)

**Service-Side Caching:**
- Database connection pooling
- Prepared statement caching
- MinIO client connection reuse
```

---

## 5. Data Flow

### 5.1 Photo Upload Flow

```
1. Service receives file upload
    ↓
2. Client.storePhoto(buffer, options)
    ↓ 
3. HTTP POST to Storage Service
    ↓
4. Service validates and coordinates:
   - Generate photo ID and S3 key
   - Store blob in MinIO
   - Store metadata in SQLite
   - Generate presigned URL
    ↓
5. Return PhotoResult to client
    ↓
6. Client caches metadata
```

### 5.2 Photo Access Flow

```
1. Service needs photo URL
    ↓
2. Client.getPhotoUrl(photoId)
    ↓
3. Check cache for metadata
    ↓ (cache miss)
4. HTTP GET to Storage Service
    ↓
5. Service queries SQLite
    ↓
6. Client generates presigned URL directly from MinIO
    ↓
7. Cache metadata and return URL
```

### 5.3 Search Flow

```
1. Service performs search
    ↓
2. Client.searchPhotos(query)
    ↓
3. HTTP POST to Storage Service
    ↓
4. Service uses SQLite FTS5
    ↓
5. Return paginated results
```

---

## 6. Deployment Strategy

```typescript
// @shared-infra/storage-service/src/server.ts


      this.logger.info('Storage Service shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown', {
        error: error.message
      });
    }
  }
}

// Service configuration interface
export interface StorageServiceConfig {
  server: {
    port: number;
    host: string;
  };
  database: {
    path: string;
    backupInterval?: number;
  };
  minio: MinioConfig;
  cache?: CacheConfig;
  performance?: PerformanceConfig;
  health?: HealthConfig;
}

// Service entry point
if (require.main === module) {
  const config: StorageServiceConfig = {
    server: {
      port: parseInt(process.env.PORT || '3001'),
      host: process.env.HOST || '0.0.0.0'
    },
    database: {
      path: process.env.SQLITE_PATH || '/data/storage.db',
      backupInterval: parseInt(process.env.BACKUP_INTERVAL || '3600')
    },
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      ttl: parseInt(process.env.CACHE_TTL || '300'),
      maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000')
    },
    performance: {
      batchSize: parseInt(process.env.BATCH_SIZE || '10'),
      connectionPoolSize: parseInt(process.env.DB_POOL_SIZE || '5')
    }
  };
  
  const service = new StorageService(config);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    await service.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await service.shutdown();
    process.exit(0);
  });
  
  // Start service
  service.start().catch((error) => {
    console.error('Failed to start service:', error);
    process.exit(1);
  });
}
```

### 4.2 Photo Routes

```typescript
// @shared-infra/storage-service/src/routes/photos.ts

import { Router, Request, Response } from 'express';
import { StorageCoordinator } from '@shared-infra/storage-core';
import { Logger } from '../middleware/logger';
import { ValidationError, PhotoNotFoundError } from '../errors';

export class PhotoRoutes {
  public router: Router;
  
  constructor(
    private storage: StorageCoordinator,
    private logger: Logger
  ) {
    this.router = Router();
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    this.router.post('/', this.storePhoto.bind(this));
    this.router.get('/:id', this.getPhoto.bind(this));
    this.router.put('/:id/metadata', this.updatePhotoMetadata.bind(this));
    this.router.delete('/:id', this.deletePhoto.bind(this));
    this.router.post('/search', this.searchPhotos.bind(this));
  }
  
  async storePhoto(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const { data, options } = req.body;
      
      if (!data || !options) {
        throw new ValidationError('Missing data or options');
      }
      
      // Decode base64 data
      const buffer = Buffer.from(data, 'base64');
      
      // Store photo using storage coordinator
      const result = await this.storage.storePhoto(buffer, {
        originalName: options.originalName,
        contentType: options.contentType,
        clientId: options.clientId,
        sessionId: options.sessionId,
        userId: options.userId,
        metadata: options.metadata
      });
      
      res.status(201).json(result);
      
      this.logger.info('Photo stored via API', {
        photoId: result.id,
        size: buffer.length,
        duration: Date.now() - startTime
      });
      
    } catch (error) {
      this.logger.error('Failed to store photo via API', {
        error: error.message,
        duration: Date.now() - startTime
      });
      
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
  
  async getPhoto(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const photo = await this.storage.getPhoto(id);
      
      if (!photo) {
        throw new PhotoNotFoundError(`Photo not found: ${id}`);
      }
      
      res.json(photo);
      
    } catch (error) {
      if (error instanceof PhotoNotFoundError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
  
  async updatePhotoMetadata(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const metadata = req.body;
      
      await this.storage.updatePhotoMetadata(id, metadata);
      res.json({ success: true });
      
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  async deletePhoto(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await this.storage.deletePhoto(id);
      res.json({ success: true });
      
    } catch (error) {
      if (error instanceof PhotoNotFoundError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
  
  async searchPhotos(req: Request, res: Response): Promise<void> {
    try {
      const query = req.body;
      const result = await this.storage.searchPhotos(query);
      res.json(result);
      
    } catch (error) {
      res.status(400).json({ error: 'Search failed' });
    }
  }
  
  async getUserPhotos(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const photos = await this.storage.getUserPhotos(userId, { limit, offset });
      res.json(photos);
      
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
```

### 4.3 Docker Configuration

```dockerfile
# @shared-infra/storage-service/Dockerfile

FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/storage-core/package*.json ./packages/storage-core/
COPY packages/storage-service/package*.json ./packages/storage-service/

# Install dependencies
RUN npm ci

# Copy source code
COPY packages/storage-core ./packages/storage-core
COPY packages/storage-service ./packages/storage-service

# Build packages
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY packages/storage-core/package*.json ./packages/storage-core/
COPY packages/storage-service/package*.json ./packages/storage-service/
RUN npm ci --only=production

# Copy built application
COPY --from=builder /app/packages/storage-core/dist ./packages/storage-core/dist
COPY --from=builder /app/packages/storage-service/dist ./packages/storage-service/dist

# Create data directory for SQLite
RUN mkdir -p /data && chown -R node:node /data

# Create non-root user
USER node

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the service
CMD ["node", "packages/storage-service/dist/server.js"]
```

```yaml
# @shared-infra/storage-service/docker-compose.yml

version: '3.8'

services:
  storage-service:
    build:
      context: ../..
      dockerfile: packages/storage-service/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - PORT=3001
      - SQLITE_PATH=/data/storage.db
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - MINIO_USE_SSL=false
      - CACHE_ENABLED=true
      - LOG_LEVEL=info
    volumes:
      - storage_data:/data
    depends_on:
      - minio
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  storage_data:
  minio_data:
```

---

## 5. Storage Coordinator Core

### 5.1 Core Implementation

```typescript
// @shared-infra/storage-core/src/coordinator.ts

import { MinIOClient } from './minio-client';
import { SQLiteClient } from './sqlite-client';
import { ConsistencyManager } from './consistency';
import { TransactionManager } from './transactions';
import { Logger } from './logger';
import { MetricsCollector } from './metrics';

export class StorageCoordinator {
  private minioClient: MinIOClient;
  private sqliteClient: SQLiteClient;
  private consistencyManager: ConsistencyManager;
  private transactionManager: TransactionManager;
  private logger: Logger;
  private metrics: MetricsCollector;
  
  constructor(private config: StorageCoordinatorConfig) {
    this.logger = new Logger('StorageCoordinator');
    this.metrics = new MetricsCollector();
    
    this.minioClient = new MinIOClient(config.minioConfig, this.logger);
    this.sqliteClient = new SQLiteClient(config.sqlitePath, this.logger);
    
    this.consistencyManager = new ConsistencyManager(
      this.minioClient,
      this.sqliteClient,
      this.logger
    );
    
    this.transactionManager = new TransactionManager(
      this.sqliteClient,
      this.minioClient,
      this.logger
    );
  }
  
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Storage Coordinator...');
      
      // Initialize SQLite database
      await this.sqliteClient.initialize();
      
      // Initialize MinIO connection
      await this.minioClient.initialize();
      
      // Run initial consistency check if enabled
      if (this.config.consistency?.runOnStartup) {
        await this.consistencyManager.performBasicCheck();
      }
      
      this.logger.info('Storage Coordinator initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize Storage Coordinator', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  async storePhoto(data: Buffer, options: StorePhotoOptions): Promise<PhotoResult> {
    const transaction = await this.transactionManager.begin();
    
    try {
      // Generate unique identifiers
      const photoId = this.generatePhotoId();
      const s3Key = this.generateS3Key(photoId, options.originalName);
      
      // Determine bucket based on content type and size
      const bucket = this.determineBucket(data, options.contentType);
      
      // Calculate checksum for integrity
      const checksum = this.calculateChecksum(data);
      
      // Store blob in MinIO
      const putResult = await this.minioClient.putObject(
        bucket,
        s3Key,
        data,
        {
          contentType: options.contentType || 'application/octet-stream',
          metadata: {
            'original-name': options.originalName,
            'client-id': options.clientId,
            'upload-timestamp': new Date().toISOString(),
            ...(options.metadata || {})
          }
        }
      );
      
      // Generate presigned URL
      const s3Url = await this.minioClient.getPresignedUrl('GET', bucket, s3Key, 3600);
      
      // Store metadata in SQLite
      const photoRecord = {
        id: photoId,
        s3_key: s3Key,
        s3_url: s3Url,
        bucket,
        file_size: data.length,
        mime_type: options.contentType || 'application/octet-stream',
        original_filename: options.originalName,
        checksum,
        client_id: options.clientId,
        session_id: options.sessionId,
        user_id: options.userId,
        processing_status: 'queued',
        uploaded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      await this.sqliteClient.insert('photos', photoRecord);
      
      // Commit transaction
      await transaction.commit();
      
      // Record metrics
      this.metrics.incrementCounter('photos_stored_total', {
        bucket,
        client_id: options.clientId
      });
      
      this.metrics.recordHistogram('photo_size_bytes', data.length, {
        bucket
      });
      
      this.logger.info('Photo stored successfully', {
        photoId,
        bucket,
        size: data.length,
        checksum
      });
      
      return {
        id: photoId,
        s3_key: s3Key,
        s3_url: s3Url,
        bucket,
        size: data.length,
        checksum,
        processing_status: 'queued',
        created_at: photoRecord.created_at
      };
      
    } catch (error) {
      await transaction.rollback();
      
      this.metrics.incrementCounter('photos_store_errors_total', {
        error_type: error.constructor.name
      });
      
      this.logger.error('Failed to store photo', {
        error: error.message,
        size: data.length
      });
      
      throw error;
    }
  }
  
  async getPhoto(photoId: string): Promise<Photo | null> {
    try {
      const photo = await this.sqliteClient.get<Photo>(
        'SELECT * FROM photos WHERE id = ?',
        [photoId]
      );
      
      if (!photo) {
        return null;
      }
      
      // Update URL if expired
      if (this.isUrlExpired(photo.s3_url)) {
        const newUrl = await this.minioClient.getPresignedUrl(
          'GET',
          photo.bucket,
          photo.s3_key,
          3600
        );
        
        await this.sqliteClient.run(
          'UPDATE photos SET s3_url = ? WHERE id = ?',
          [newUrl, photoId]
        );
        
        photo.s3_url = newUrl;
      }
      
      return photo;
      
    } catch (error) {
      this.logger.error('Failed to get photo', {
        photoId,
        error: error.message
      });
      throw error;
    }
  }
  
  async searchPhotos(query: SearchQuery): Promise<SearchResult> {
    try {
      const { sql, params } = this.buildSearchQuery(query);
      const photos = await this.sqliteClient.all<Photo>(sql, params);
      
      // Get total count for pagination
      const countSql = sql.replace(/SELECT \*/g, 'SELECT COUNT(*)').replace(/ORDER BY .*/g, '');
      const countResult = await this.sqliteClient.get<{ 'COUNT(*)': number }>(countSql, params);
      
      return {
        photos,
        total: countResult?.['COUNT(*)'] || 0,
        page: {
          limit: query.limit || 50,
          offset: query.offset || 0,
          hasMore: photos.length === (query.limit || 50)
        },
        searchTime: 0 // TODO: implement timing
      };
      
    } catch (error) {
      this.logger.error('Search failed', {
        query,
        error: error.message
      });
      throw error;
    }
  }
  
  async getUserPhotos(userId: string, options: PaginationOptions): Promise<PhotoPage> {
    try {
      const limit = options.limit || 50;
      const offset = options.offset || 0;
      
      const photos = await this.sqliteClient.all<Photo>(
        'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        [userId, limit, offset]
      );
      
      const countResult = await this.sqliteClient.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM photos WHERE user_id = ?',
        [userId]
      );
      
      return {
        photos,
        pagination: {
          total: countResult?.count || 0,
          limit,
          offset,
          hasMore: photos.length === limit
        }
      };
      
    } catch (error) {
      this.logger.error('Failed to get user photos', {
        userId,
        error: error.message
      });
      throw error;
    }
  }
  
  async updatePhotoMetadata(photoId: string, metadata: Partial<PhotoMetadata>): Promise<void> {
    try {
      const updates = Object.keys(metadata).map(key => `${key} = ?`).join(', ');
      const values = Object.values(metadata);
      
      await this.sqliteClient.run(
        `UPDATE photos SET ${updates}, updated_at = ? WHERE id = ?`,
        [...values, new Date().toISOString(), photoId]
      );
      
    } catch (error) {
      this.logger.error('Failed to update photo metadata', {
        photoId,
        error: error.message
      });
      throw error;
    }
  }
  
  async deletePhoto(photoId: string): Promise<void> {
    const transaction = await this.transactionManager.begin();
    
    try {
      // Get photo info first
      const photo = await this.getPhoto(photoId);
      if (!photo) {
        throw new PhotoNotFoundError(`Photo not found: ${photoId}`);
      }
      
      // Delete from MinIO
      await this.minioClient.removeObject(photo.bucket, photo.s3_key);
      
      // Delete from SQLite
      await this.sqliteClient.run('DELETE FROM photos WHERE id = ?', [photoId]);
      
      await transaction.commit();
      
      this.logger.info('Photo deleted', { photoId });
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  
  async close(): Promise<void> {
    try {
      await this.sqliteClient.close();
      this.logger.info('Storage Coordinator closed');
    } catch (error) {
      this.logger.error('Error closing Storage Coordinator', {
        error: error.message
      });
    }
  }
  
  // === PRIVATE METHODS ===
  
  private generatePhotoId(): string {
    return require('crypto').randomUUID();
  }
  
  private generateS3Key(photoId: string, originalName: string): string {
    const timestamp = Date.now();
    const extension = originalName.split('.').pop() || '';
    return `photos/${timestamp}/${photoId}.${extension}`;
  }
  
  private determineBucket(data: Buffer, contentType?: string): string {
    const size = data.length;
    const type = contentType || 'application/octet-stream';
    
    if (type.startsWith('image/')) {
      if (size > 10 * 1024 * 1024) { // > 10MB
        return 'images-large';
      }
      return 'images';
    }
    
    if (type.startsWith('video/')) {
      return 'videos';
    }
    
    return 'files';
  }
  
  private calculateChecksum(data: Buffer): string {
    return require('crypto').createHash('sha256').update(data).digest('hex');
  }
  
  private isUrlExpired(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const expires = urlObj.searchParams.get('X-Amz-Expires');
      if (!expires) return false;
      
      const expiryTime = parseInt(expires) * 1000;
      return Date.now() > expiryTime;
    } catch {
      return true;
    }
  }
  
  private buildSearchQuery(query: SearchQuery): { sql: string; params: any[] } {
    let sql = 'SELECT * FROM photos WHERE 1=1';
    const params: any[] = [];
    
    if (query.query) {
      sql += ' AND (original_filename LIKE ? OR mime_type LIKE ?)';
      params.push(`%${query.query}%`, `%${query.query}%`);
    }
    
    if (query.filters?.client_id) {
      sql += ' AND client_id = ?';
      params.push(query.filters.client_id);
    }
    
    if (query.filters?.user_id) {
      sql += ' AND user_id = ?';
      params.push(query.filters.user_id);
    }
    
    if (query.filters?.mime_type) {
      sql += ` AND mime_type IN (${query.filters.mime_type.map(() => '?').join(',')})`;
      params.push(...query.filters.mime_type);
    }
    
    if (query.filters?.date_range) {
      sql += ' AND uploaded_at BETWEEN ? AND ?';
      params.push(query.filters.date_range.start, query.filters.date_range.end);
    }
    
    if (query.sort) {
      sql += ` ORDER BY ${query.sort.field} ${query.sort.order.toUpperCase()}`;
    } else {
      sql += ' ORDER BY uploaded_at DESC';
    }
    
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
      
      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }
    
    return { sql, params };
  }
}
```

---

## 6. Data Models & Schemas

### 6.1 SQLite Schema

```sql
-- @shared-infra/storage-core/migrations/001_initial.sql

-- Core photo metadata table
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  s3_key TEXT NOT NULL UNIQUE,
  s3_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  
  -- Content metadata
  width INTEGER,
  height INTEGER,
  duration INTEGER, -- for videos
  checksum TEXT,
  
  -- Client context
  client_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  
  -- Processing information
  processing_status TEXT NOT NULL DEFAULT 'queued' 
    CHECK (processing_status IN ('queued', 'in_progress', 'completed', 'failed', 'cancelled')),
  processing_metadata TEXT, -- JSON blob
  processing_error TEXT,
  
  -- Timestamps
  uploaded_at TEXT NOT NULL,
  processing_started_at TEXT,
  processing_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_photos_client_id ON photos(client_id);
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_processing_status ON photos(processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_photos_bucket_key ON photos(bucket, s3_key);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS photos_search USING fts5(
  photo_id UNINDEXED,
  filename,
  mime_type,
  content='photos',
  content_rowid='rowid'
);

-- Triggers for timestamp updates
CREATE TRIGGER IF NOT EXISTS update_photos_timestamp 
  AFTER UPDATE ON photos
BEGIN
  UPDATE photos SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Triggers for search index
CREATE TRIGGER IF NOT EXISTS photos_search_insert 
  AFTER INSERT ON photos 
BEGIN
  INSERT INTO photos_search(photo_id, filename, mime_type)
  VALUES (NEW.id, NEW.original_filename, NEW.mime_type);
END;

CREATE TRIGGER IF NOT EXISTS photos_search_update 
  AFTER UPDATE ON photos 
BEGIN
  INSERT INTO photos_search(photos_search, photo_id, filename, mime_type)
  VALUES ('delete', OLD.id, OLD.original_filename, OLD.mime_type);
  INSERT INTO photos_search(photo_id, filename, mime_type)
  VALUES (NEW.id, NEW.original_filename, NEW.mime_type);
END;

CREATE TRIGGER IF NOT EXISTS photos_search_delete 
  AFTER DELETE ON photos 
BEGIN
  INSERT INTO photos_search(photos_search, photo_id, filename, mime_type)
  VALUES ('delete', OLD.id, OLD.original_filename, OLD.mime_type);
END;
```

### 6.2 TypeScript Interfaces

```typescript
// @shared-infra/storage-core/src/types.ts

export interface StorageCoordinatorConfig {
  sqlitePath: string;
  minioConfig: MinioConfig;
  cacheConfig?: CacheConfig;
  performanceConfig?: PerformanceConfig;
  consistency?: ConsistencyConfig;
}

export interface MinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export interface StorePhotoOptions {
  originalName: string;
  contentType?: string;
  clientId: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, string>;
}

export interface PhotoResult {
  id: string;
  s3_key: string;
  s3_url: string;
  bucket: string;
  size: number;
  checksum?: string;
  processing_status: ProcessingStatus;
  created_at: string;
}

export interface Photo extends PhotoResult {
  original_filename: string;
  mime_type: string;
  width?: number;
  height?: number;
  client_id: string;
  session_id?: string;
  user_id?: string;
  uploaded_at: string;
  updated_at: string;
}

export type ProcessingStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
```

---

## 7. Consistency Management

The consistency management system ensures data integrity across SQLite and MinIO storage layers.

### 7.1 Consistency Manager

```typescript
// @shared-infra/storage-core/src/consistency.ts

export class ConsistencyManager {
  constructor(
    private minio: MinIOClient,
    private sqlite: SQLiteClient,
    private logger: Logger
  ) {}
  
  async performBasicCheck(): Promise<void> {
    this.logger.info('Running basic consistency check...');
    
    // Check for orphaned records (metadata without blobs)
    const orphanedRecords = await this.findOrphanedRecords();
    if (orphanedRecords.length > 0) {
      this.logger.warn(`Found ${orphanedRecords.length} orphaned records`);
      
      // Option: mark as failed or delete
      for (const record of orphanedRecords) {
        await this.sqlite.run(
          'UPDATE photos SET processing_status = ?, processing_error = ? WHERE id = ?',
          ['failed', 'Blob not found in storage', record.id]
        );
      }
    }
    
    // Check for orphaned blobs (blobs without metadata)
    const orphanedBlobs = await this.findOrphanedBlobs();
    if (orphanedBlobs.length > 0) {
      this.logger.warn(`Found ${orphanedBlobs.length} orphaned blobs`);
      // Could implement cleanup or quarantine
    }
  }
  
  private async findOrphanedRecords(): Promise<Photo[]> {
    const photos = await this.sqlite.all<Photo>('SELECT * FROM photos');
    const orphaned: Photo[] = [];
    
    for (const photo of photos) {
      try {
        await this.minio.statObject(photo.bucket, photo.s3_key);
      } catch (error) {
        if (error.code === 'NotFound') {
          orphaned.push(photo);
        }
      }
    }
    
    return orphaned;
  }
  
  private async findOrphanedBlobs(): Promise<string[]> {
    // Implementation would list all objects and check against database
    // This is a simplified version
    return [];
  }
}
```

---

## 8. Performance & Optimization

### 8.1 Caching Strategy

```typescript
// @shared-infra/storage-client/src/cache.ts

export class CacheManager {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;
  
  constructor(config: CacheConfig = { enabled: true, ttl: 300, maxSize: 1000 }) {
    this.ttl = config.ttl;
    
    // Cleanup expired entries periodically
    setInterval(() => this.cleanup(), 60000); // Every minute
  }
  
  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }
  
  async set(key: string, data: any, ttl?: number): Promise<void> {
    const expiresAt = Date.now() + (ttl || this.ttl) * 1000;
    this.cache.set(key, { data, expiresAt });
  }
  
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }
  
  isEnabled(): boolean {
    return true;
  }
  
  getTTL(): number {
    return this.ttl;
  }
  
  async ping(): Promise<void> {
    // Health check for cache
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

interface CacheEntry {
  data: any;
  expiresAt: number;
}
```

### 8.2 Connection Pooling

```typescript
// @shared-infra/storage-core/src/sqlite-client.ts

export class SQLiteClient {
  private db: any;
  private logger: Logger;
  
  constructor(private dbPath: string, logger: Logger) {
    this.logger = logger;
  }
  
  async initialize(): Promise<void> {
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = memory');
    
    // Run migrations
    await this.runMigrations();
  }
  
  async get<T>(sql: string, params: any[] = []): Promise<T | null> {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) || null;
    } catch (error) {
      this.logger.error('SQLite get error', { sql, error: error.message });
      throw error;
    }
  }
  
  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      this.logger.error('SQLite all error', { sql, error: error.message });
      throw error;
    }
  }
  
  async run(sql: string, params: any[] = []): Promise<void> {
    try {
      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    } catch (error) {
      this.logger.error('SQLite run error', { sql, error: error.message });
      throw error;
    }
  }
  
  async insert(table: string, data: Record<string, any>): Promise<void> {
    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);
    
    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
    await this.run(sql, values);
  }
  
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
  
  private async runMigrations(): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    const migrationsPath = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsPath).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const migration = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
        this.db.exec(migration);
        this.logger.info(`Applied migration: ${file}`);
      }
    }
  }
}
```

---

## 9. Security & Access Control

### 9.1 Input Validation

```typescript
// @shared-infra/storage-core/src/validation.ts

export class ValidationService {
  private static readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml'
  ];
  
  private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  
  static validateStorePhotoOptions(options: StorePhotoOptions): void {
    if (!options.originalName || typeof options.originalName !== 'string') {
      throw new ValidationError('originalName is required');
    }
    
    if (!options.clientId || typeof options.clientId !== 'string') {
      throw new ValidationError('clientId is required');
    }
    
    if (options.contentType && !this.ALLOWED_MIME_TYPES.includes(options.contentType)) {
      throw new ValidationError(`Unsupported content type: ${options.contentType}`);
    }
    
    // Sanitize filename
    if (!/^[\w\-. ]+$/.test(options.originalName)) {
      throw new ValidationError('Invalid characters in filename');
    }
  }
  
  static validateFileData(data: Buffer): void {
    if (!data || data.length === 0) {
      throw new ValidationError('File data cannot be empty');
    }
    
    if (data.length > this.MAX_FILE_SIZE) {
      throw new ValidationError(`File too large: ${data.length} > ${this.MAX_FILE_SIZE}`);
    }
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### 9.2 Access Logging

```typescript
// @shared-infra/storage-service/src/middleware/access-logger.ts

export class AccessLogger {
  constructor(private logger: Logger) {}
  
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      
      // Log request
      this.logger.info('Request started', {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        contentLength: req.get('Content-Length')
      });
      
      // Log response
      res.on('finish', () => {
        this.logger.info('Request completed', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: Date.now() - startTime,
          responseSize: res.get('Content-Length')
        });
      });
      
      next();
    };
  }
}
```

---

## 10. Deployment & Configuration

### 10.1 Package.json Files

```json
// @shared-infra/storage-client/package.json
{
  "name": "@shared-infra/storage-client",
  "version": "1.0.0",
  "description": "Client library for storage service",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "minio": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0"
  }
}
```

```json
// @shared-infra/storage-service/package.json
{
  "name": "@shared-infra/storage-service",
  "version": "1.0.0",
  "description": "Deployable storage service",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "test": "jest",
    "docker:build": "docker build -t storage-service .",
    "docker:run": "docker run -p 3001:3001 storage-service"
  },
  "dependencies": {
    "@shared-infra/storage-core": "^1.0.0",
    "express": "^4.18.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0"
  }
}
```

```json
// @shared-infra/storage-core/package.json
{
  "name": "@shared-infra/storage-core",
  "version": "1.0.0",
  "description": "Core storage functionality",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "minio": "^8.0.0",
    "better-sqlite3": "^9.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### 10.2 Kubernetes Deployment

```yaml
# @shared-infra/storage-service/k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storage-service
  labels:
    app: storage-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: storage-service
  template:
    metadata:
      labels:
        app: storage-service
    spec:
      containers:
      - name: storage-service
        image: storage-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: PORT
          value: "3001"
        - name: SQLITE_PATH
          value: "/data/storage.db"
        - name: MINIO_ENDPOINT
          value: "minio-service"
        - name: MINIO_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: minio-credentials
              key: access-key
        - name: MINIO_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: minio-credentials
              key: secret-key
        volumeMounts:
        - name: storage-data
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: storage-data
        persistentVolumeClaim:
          claimName: storage-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: storage-service
spec:
  selector:
    app: storage-service
  ports:
  - port: 3001
    targetPort: 3001
  type: ClusterIP
```

### 10.3 Environment Configuration

```bash
# .env.example for development
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# Database
SQLITE_PATH=./data/storage.db
BACKUP_INTERVAL=3600

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# Cache Configuration
CACHE_ENABLED=true
CACHE_TTL=300
CACHE_MAX_SIZE=1000

# Performance
BATCH_SIZE=10
DB_POOL_SIZE=5

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
// @shared-infra/storage-client/src/__tests__/storage-client.test.ts

import { StorageClient } from '../client';
import { MockStorageService } from './mocks/storage-service';

describe('StorageClient', () => {
  let client: StorageClient;
  let mockService: MockStorageService;
  
  beforeEach(() => {
    mockService = new MockStorageService();
    client = new StorageClient({
      storageServiceUrl: 'http://localhost:3001',
      minioConfig: {
        endPoint: 'localhost',
        port: 9000,
        useSSL: false,
        accessKey: 'test',
        secretKey: 'test'
      }
    });
  });
  
  describe('storePhoto', () => {
    it('should store photo successfully', async () => {
      const data = Buffer.from('test image data');
      const options = {
        originalName: 'test.jpg',
        contentType: 'image/jpeg',
        clientId: 'test-client'
      };
      
      const result = await client.storePhoto(data, options);
      
      expect(result.id).toBeDefined();
      expect(result.s3_key).toBeDefined();
      expect(result.processing_status).toBe('queued');
    });
    
    it('should handle errors gracefully', async () => {
      mockService.simulateError();
      
      const data = Buffer.from('test');
      const options = {
        originalName: 'test.jpg',
        clientId: 'test-client'
      };
      
      await expect(client.storePhoto(data, options))
        .rejects.toThrow('Failed to store photo');
    });
  });
});
```

### 11.2 Integration Tests

```typescript
// @shared-infra/storage-service/src/__tests__/integration.test.ts

import request from 'supertest';
import { StorageService } from '../server';
import { TestDatabase } from './helpers/test-database';

describe('Storage Service Integration', () => {
  let service: StorageService;
  let testDb: TestDatabase;
  
  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.setup();
    
    service = new StorageService({
      server: { port: 0, host: 'localhost' },
      database: { path: testDb.path },
      minio: testDb.minioConfig
    });
    
    await service.start();
  });
  
  afterAll(async () => {
    await service.shutdown();
    await testDb.cleanup();
  });
  
  describe('POST /photos', () => {
    it('should store photo and return metadata', async () => {
      const photoData = Buffer.from('fake image data').toString('base64');
      
      const response = await request(service.app)
        .post('/photos')
        .send({
          data: photoData,
          options: {
            originalName: 'test.jpg',
            contentType: 'image/jpeg',
            clientId: 'test-client'
          }
        })
        .expect(201);
      
      expect(response.body.id).toBeDefined();
      expect(response.body.s3_key).toBeDefined();
      expect(response.body.processing_status).toBe('queued');
    });
  });
  
  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(service.app)
        .get('/health')
        .expect(200);
      
      expect(response.body.service).toBe('healthy');
    });
  });
});
```

---

## 12. Implementation Guidelines

### 12.1 Usage Examples

#### Backend Service Usage

```typescript
// Example: API service using storage client
import { StorageClient } from '@shared-infra/storage-client';

const storage = new StorageClient({
  storageServiceUrl: process.env.STORAGE_SERVICE_URL || 'http://storage-service:3001',
  minioConfig: {
    endPoint: process.env.MINIO_ENDPOINT || 'minio',
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
});

// Store uploaded photo
app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    const result = await storage.storePhoto(req.file.buffer, {
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      clientId: req.user.clientId,
      userId: req.user.id,
      sessionId: req.sessionID
    });
    
    res.json({
      photoId: result.id,
      url: result.s3_url,
      status: result.processing_status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user photos
app.get('/users/:userId/photos', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const result = await storage.getUserPhotos(userId, { limit, offset });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search photos
app.post('/search', async (req, res) => {
  try {
    const result = await storage.searchPhotos(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### Worker Service Usage

```typescript
// Example: Background processing worker
import { StorageClient } from '@shared-infra/storage-client';

class PhotoProcessor {
  private storage: StorageClient;
  
  constructor() {
    this.storage = new StorageClient({
      storageServiceUrl: process.env.STORAGE_SERVICE_URL,
      minioConfig: { /* MinIO config */ }
    });
  }
  
  async processPhoto(photoId: string): Promise<void> {
    try {
      // Get photo metadata
      const photo = await this.storage.getPhoto(photoId);
      if (!photo) {
        throw new Error(`Photo not found: ${photoId}`);
      }
      
      // Get direct access URL for processing
      const url = await this.storage.getPhotoUrl(photoId, 3600);
      
      // Download and process the image
      const processedData = await this.processImage(url);
      
      // Update metadata with processing results
      await this.storage.updatePhotoMetadata(photoId, {
        processing_status: 'completed',
        processing_completed_at: new Date().toISOString(),
        processing_metadata: JSON.stringify(processedData)
      });
      
    } catch (error) {
      await this.storage.updatePhotoMetadata(photoId, {
        processing_status: 'failed',
        processing_error: error.message
      });
      throw error;
    }
  }
  
  private async processImage(url: string): Promise<any> {
    // Image processing logic here
    return { width: 1024, height: 768, size: 'large' };
  }
}
```

### 12.2 Development Setup

```bash
# 1. Clone and setup workspace
git clone <repository>
cd shared-infra
npm install

# 2. Build all packages
npm run build

# 3. Start development environment
docker-compose up -d minio
npm run dev:storage-service

# 4. Run tests
npm test

# 5. Build for production
npm run build
npm run docker:build
```

### 12.3 Monitoring & Observability

```typescript
// Example: Custom metrics and monitoring
import { StorageClient } from '@shared-infra/storage-client';

class MonitoredStorageClient extends StorageClient {
  private metrics: MetricsCollector;
  
  constructor(config: StorageClientConfig) {
    super(config);
    this.metrics = new MetricsCollector();
  }
  
  async storePhoto(data: Buffer, options: StorePhotoOptions): Promise<PhotoResult> {
    const startTime = Date.now();
    
    try {
      const result = await super.storePhoto(data, options);
      
      this.metrics.recordHistogram('photo_upload_duration', Date.now() - startTime);
      this.metrics.recordHistogram('photo_upload_size', data.length);
      this.metrics.incrementCounter('photos_uploaded_total', {
        client_id: options.clientId,
        success: 'true'
      });
      
      return result;
    } catch (error) {
      this.metrics.incrementCounter('photos_uploaded_total', {
        client_id: options.clientId,
        success: 'false',
        error: error.constructor.name
      });
      throw error;
    }
  }
}
```

### 12.4 Production Considerations

1. **Scaling**: Deploy multiple instances of the storage service behind a load balancer
2. **Monitoring**: Use Prometheus/Grafana for metrics and alerting
3. **Backup**: Regular SQLite backups and MinIO replication
4. **Security**: TLS encryption, network policies, secret management
5. **Performance**: Connection pooling, caching, CDN for static assets

This architecture provides a clean separation of concerns with the client library handling communication and caching, while the storage service manages the core storage operations. The deployment is straightforward with Docker containers and can scale horizontally as needed.