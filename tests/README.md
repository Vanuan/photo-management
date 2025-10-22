# Integration and E2E Tests

This directory contains comprehensive end-to-end integration tests for the photo management system.

## Overview

The test suite verifies the complete photo upload and processing flow across all services:
- Frontend (photo capture and caching)
- API Gateway (upload endpoint)
- Storage Service (MinIO and SQLite)
- Event Bus (Redis/Socket.IO)
- Job Queue (BullMQ)
- Worker Service (photo processing)

## Test Structure

```
tests/
├── integration/                 # Integration tests
│   ├── setup.ts                # Test environment setup
│   ├── teardown.ts             # Test environment cleanup
│   ├── photo-upload.test.ts    # Main E2E tests
│   ├── error-handling.test.ts  # Error scenarios
│   └── utils/                  # Test utilities
│       ├── api-client.ts       # API helper
│       ├── websocket-client.ts # WebSocket helper
│       ├── test-data.ts        # Test data generators
│       └── assertions.ts       # Custom assertions
└── performance/                 # Performance benchmarks
    └── upload-benchmark.test.ts
```

## Prerequisites

- Docker and Docker Compose
- Node.js 20+
- npm 9+

## Running Tests

### Install Dependencies

```bash
npm install
```

### Run All Tests

```bash
npm run test:all
```

### Run Integration Tests Only

```bash
npm run test:integration
```

### Run E2E Tests Only

```bash
npm run test:e2e
```

### Run Performance Tests

```bash
npm run test:performance
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

## Docker Commands

### Start Services Manually

```bash
npm run docker:up
```

### Stop Services

```bash
npm run docker:down
```

### View Service Logs

```bash
npm run docker:logs
```

### Check Service Status

```bash
npm run docker:ps
```

## Test Scenarios

### Happy Path Tests

- **Complete Upload Flow**: Tests the full journey from upload to processing completion
- **Thumbnail Generation**: Verifies thumbnail creation and storage
- **Metadata Handling**: Validates photo metadata across all services
- **Sequential Uploads**: Tests multiple sequential uploads
- **Concurrent Uploads**: Tests parallel upload handling
- **Pagination**: Tests photo listing with pagination
- **User Isolation**: Verifies user can only see their own photos
- **Photo Deletion**: Tests deletion and resource cleanup

### Error Handling Tests

- **Upload Validation**: Tests invalid uploads (empty, corrupt, missing fields)
- **Large File Handling**: Tests large photo uploads (5MB+)
- **Not Found Errors**: Tests 404 handling for non-existent resources
- **Authorization**: Tests user access control
- **Concurrent Operations**: Tests race conditions and concurrent access
- **Processing Failures**: Tests worker failure handling and retries
- **Network Resilience**: Tests handling of network issues
- **Rate Limiting**: Tests system behavior under load
- **Data Integrity**: Tests data consistency across operations

### Performance Tests

- **Upload Response Time**: Target < 2 seconds
- **Processing Time**: Target < 30 seconds
- **WebSocket Latency**: Target < 500ms
- **Concurrent Throughput**: Target > 10 uploads/second
- **Burst Traffic**: Tests handling of traffic spikes
- **Latency Percentiles**: Measures p50, p95, p99 latencies
- **Scalability**: Tests with 20+ concurrent uploads

## Environment Variables

Tests use the following environment variables:

```bash
# Test environment
NODE_ENV=test
CI=true  # Set in CI/CD

# Service endpoints (defaults to localhost)
API_GATEWAY_URL=http://localhost:3000
STORAGE_SERVICE_URL=http://localhost:3001
REDIS_HOST=localhost
REDIS_PORT=6379
MINIO_ENDPOINT=localhost
MINIO_PORT=9000

# Test configuration
COLLECT_LOGS=true  # Collect Docker logs on failure
```

## Test Utilities

### APIClient

Helper class for making API requests:

```typescript
import { APIClient } from './utils/api-client';

const apiClient = new APIClient('http://localhost:3000');

// Upload photo
const result = await apiClient.uploadPhoto(buffer, userId, filename);

// Wait for processing
await apiClient.waitForProcessingComplete(photoId);

// Get photo
const photo = await apiClient.getPhoto(photoId);
```

### WebSocketClient

Helper class for WebSocket testing:

```typescript
import { WebSocketClient } from './utils/websocket-client';

const wsClient = new WebSocketClient('http://localhost:3000', userId);
await wsClient.connect();

// Wait for event
const event = await wsClient.waitForProcessingComplete(photoId);

// Get all events
const events = wsClient.getEventsForPhoto(photoId);
```

### Test Data Generators

Generate test images and data:

```typescript
import { generateTestImage, generateTestPhotoData } from './utils/test-data';

// Generate test image
const buffer = await generateTestImage(800, 600);

// Generate complete test photo data
const photo = await generateTestPhotoData(userId, 'test.jpg');
```

### Custom Assertions

Custom assertion helpers:

```typescript
import { assertPhotoStatus, assertMinIOObjectExists } from './utils/assertions';

// Assert photo status
assertPhotoStatus(photo, 'completed');

// Assert MinIO object exists
await assertMinIOObjectExists('photos', photo.filepath);
```

## CI/CD Integration

Tests run automatically on GitHub Actions:

- **Integration Tests**: Run on all PRs and pushes
- **E2E Tests**: Run on all PRs and pushes
- **Performance Tests**: Run only on main branch pushes

See `.github/workflows/integration-tests.yml` for configuration.

## Troubleshooting

### Services Not Starting

```bash
# Check service status
npm run docker:ps

# View logs
npm run docker:logs

# Restart services
npm run docker:down && npm run docker:up
```

### Tests Timing Out

- Increase timeout in Jest config
- Check if services are healthy: `npm run wait-for-services`
- Check Docker resource allocation

### Port Conflicts

If ports 3000, 3001, 6379, or 9000 are in use:
- Stop conflicting services
- Modify ports in `docker-compose.e2e.yml`

### Test Data Not Clearing

```bash
# Manually clear all test data
npm run docker:down
npm run docker:up
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up test data between tests
3. **Timeouts**: Set appropriate timeouts for async operations
4. **Assertions**: Use descriptive assertions and error messages
5. **Logging**: Log important test steps for debugging
6. **Performance**: Keep tests fast but comprehensive

## Contributing

When adding new tests:

1. Follow existing test structure and naming conventions
2. Add appropriate documentation
3. Ensure tests are idempotent
4. Clean up resources in `afterEach` hooks
5. Use provided utilities and helpers
6. Update this README if needed

## Success Criteria

✅ All E2E tests pass
✅ Coverage of happy path and error scenarios
✅ Performance benchmarks met
✅ CI/CD pipeline runs tests automatically
✅ Test execution time < 5 minutes for integration tests
✅ Test execution time < 10 minutes for full suite
