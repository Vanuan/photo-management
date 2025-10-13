# Storage Layer - Shared Infrastructure

This is the Storage Layer implementation for the photo management system, providing a robust, scalable solution for photo storage and metadata management.

## Architecture Overview

The Storage Layer follows a **dual-package architecture** with clear separation of concerns:

- **Storage Core** (`@shared-infra/storage-core`): Shared business logic, database operations, and MinIO client
- **Storage Service** (`@shared-infra/storage-service`): Deployable REST API service 
- **Storage Client** (`@shared-infra/storage-client`): Lightweight client library for service integration

## Key Features

✅ **Dual Storage**: SQLite for metadata + MinIO for blob storage  
✅ **Direct Access**: Presigned URLs for performance-critical operations  
✅ **Smart Caching**: Built-in client-side caching with TTL management  
✅ **Full-Text Search**: SQLite FTS5 for fast photo search  
✅ **Transaction Safety**: ACID guarantees with automatic rollback  
✅ **Health Monitoring**: Comprehensive health checks and metrics  
✅ **Production Ready**: Docker support, graceful shutdown, error handling  

## Quick Start

### 1. Install Dependencies

```bash
# Install all packages
npm install

# Build all packages
npm run build
```

### 2. Start Development Environment

```bash
# Start MinIO and Storage Service
docker-compose up minio storage-service

# Or start everything
docker-compose up
```

### 3. Use the Storage Client

```javascript
import { StorageClient } from '@shared-infra/storage-client';

const client = new StorageClient({
  storageServiceUrl: 'http://localhost:3001',
  minioConfig: {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin'
  }
});

// Store a photo
const result = await client.storePhoto(imageBuffer, {
  originalName: 'vacation.jpg',
  contentType: 'image/jpeg',
  clientId: 'my-app',
  userId: 'user-123'
});

console.log('Photo stored:', result.id);

// Get photo metadata
const photo = await client.getPhoto(result.id);
console.log('Photo details:', photo);

// Get presigned URL for direct access
const url = await client.getPhotoUrl(result.id, 3600); // 1 hour expiry
console.log('Direct access URL:', url);
```

## API Endpoints

### Photos
- `POST /api/v1/photos` - Store photo
- `GET /api/v1/photos/:id` - Get photo metadata
- `GET /api/v1/photos/:id/url` - Get presigned URL
- `PUT /api/v1/photos/:id/metadata` - Update metadata
- `DELETE /api/v1/photos/:id` - Delete photo
- `POST /api/v1/photos/search` - Search photos
- `GET /api/v1/photos/user/:userId` - Get user photos

### Health
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=3001
HOST=0.0.0.0

# Database
SQLITE_PATH=./data/storage.db

# MinIO Configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# Caching
CACHE_ENABLED=true
CACHE_TTL=300
CACHE_MAX_SIZE=1000

# Logging
LOG_LEVEL=info
```

### Storage Client Configuration

```javascript
const config = {
  storageServiceUrl: 'http://localhost:3001',
  minioConfig: {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin'
  },
  cacheConfig: {
    enabled: true,
    ttl: 300,      // 5 minutes
    maxSize: 1000  // max items in cache
  },
  retryConfig: {
    maxRetries: 3,
    retryDelay: 1000,
    backoffFactor: 2
  },
  timeout: 30000
};
```

## Development

### Project Structure

```
shared-infra/
├── packages/
│   ├── storage-client/           # Client library
│   │   ├── src/
│   │   │   ├── client.ts         # Main client class
│   │   │   ├── cache.ts          # Caching layer
│   │   │   └── logger.ts         # Logging utilities
│   │   └── package.json
│   │
│   ├── storage-service/          # REST API service
│   │   ├── src/
│   │   │   ├── server.ts         # Express server
│   │   │   ├── routes/           # API routes
│   │   │   └── middleware/       # Express middleware
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── storage-core/             # Core functionality
│       ├── src/
│       │   ├── coordinator.ts    # Main storage orchestrator
│       │   ├── minio-client.ts   # MinIO operations
│       │   ├── sqlite-client.ts  # SQLite operations
│       │   └── types.ts          # TypeScript definitions
│       ├── migrations/           # Database migrations
│       └── package.json
│
├── docker-compose.yml            # Development environment
├── package.json                  # Workspace configuration
└── README.md
```

### Development Commands

```bash
# Build all packages
npm run build

# Run tests
npm run test

# Start development service
npm run dev

# Build Docker images
npm run docker:build

# Clean build artifacts
npm run clean
```

### Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Integration tests
npm run test:integration
```

## Database Schema

The SQLite database uses the following main table:

```sql
CREATE TABLE photos (
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
  duration INTEGER,
  checksum TEXT,
  
  -- Client context
  client_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  
  -- Processing status
  processing_status TEXT DEFAULT 'queued',
  processing_metadata TEXT,
  processing_error TEXT,
  
  -- Timestamps
  uploaded_at TEXT NOT NULL,
  processing_started_at TEXT,
  processing_completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Full-text search is enabled via SQLite FTS5 for fast photo discovery.

## Deployment

### Docker Compose (Recommended for Development)

```bash
# Start all services
docker-compose up

# Production build
docker-compose --profile production up
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storage-service
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
        - name: SQLITE_PATH
          value: "/data/storage.db"
        # ... other env vars
        volumeMounts:
        - name: storage-data
          mountPath: /data
```

### Manual Deployment

```bash
# Build production image
docker build -t storage-service packages/storage-service

# Run with external MinIO
docker run -p 3001:3001 \
  -e MINIO_ENDPOINT=your-minio-host \
  -e MINIO_ACCESS_KEY=your-access-key \
  -e MINIO_SECRET_KEY=your-secret-key \
  -v /path/to/data:/app/data \
  storage-service
```

## Monitoring

### Health Checks

```bash
# Basic health
curl http://localhost:3001/health

# Detailed system info
curl http://localhost:3001/health/detailed

# Kubernetes probes
curl http://localhost:3001/health/ready
curl http://localhost:3001/health/live
```

### Logs

The service provides structured JSON logging:

```json
{
  "level": "info",
  "message": "Photo stored successfully",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "component": "StorageCoordinator",
  "photoId": "123e4567-e89b-12d3-a456-426614174000",
  "size": 2048000,
  "bucket": "images"
}
```

### Metrics

Key metrics to monitor:

- **Photos stored/retrieved per second**
- **Average response times**
- **Cache hit/miss ratios** 
- **Database connection health**
- **MinIO connectivity status**
- **Disk usage** (SQLite database size)

## Performance Tuning

### SQLite Optimizations

- WAL mode enabled for better concurrency
- Prepared statement caching
- Connection pooling
- Optimized indexes on frequently queried columns

### Caching Strategy

- **Client-side**: Photo metadata (5min TTL)
- **URL caching**: Presigned URLs with expiry tracking
- **Search results**: Short-lived cache for repeated queries

### MinIO Configuration

- **Bucket strategy**: Separate buckets by content type and size
- **Presigned URLs**: Direct client access bypasses service
- **Connection reuse**: Persistent connections to MinIO

## Security

### Input Validation

- File size limits (50MB default)
- Content type validation
- Filename sanitization
- SQL injection prevention

### Access Control

- Request ID tracking for audit trails
- Rate limiting capabilities
- CORS configuration
- Secure default configurations

### Production Hardening

- Non-root container execution
- Secrets management via environment variables
- TLS encryption support
- Network policies

## Troubleshooting

### Common Issues

**Service won't start:**
```bash
# Check MinIO connectivity
docker-compose logs minio

# Verify database permissions
ls -la ./data/
```

**Photos not storing:**
```bash
# Check storage service logs
docker-compose logs storage-service

# Verify MinIO buckets exist
docker-compose exec minio mc ls myminio/
```

**Search not working:**
```bash
# Check FTS5 extension
sqlite3 ./data/storage.db "SELECT * FROM photos_search LIMIT 1;"
```

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug

# Start with debug profile
docker-compose --profile debug up
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run the full test suite
6. Submit a pull request

### Code Style

- TypeScript with strict mode
- ESLint configuration included
- Prettier for formatting
- Comprehensive error handling

## License

MIT License - see LICENSE file for details.

## Support

For questions and support:
- Create an issue on GitHub
- Check the troubleshooting section above
- Review the API documentation in `/docs`

---

**Next Steps:**
- See [Usage Guide](./docs/storage/usage.md) for detailed examples
- Check [SQLite Documentation](./docs/storage/sqlite.md) for database details  
- Review [MinIO Documentation](./docs/storage/minio.md) for storage configuration