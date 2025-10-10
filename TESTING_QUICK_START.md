# Testing Quick Start Guide

Get up and running with E2E tests in 5 minutes! 🚀

## Prerequisites

Ensure you have installed:
- Docker Desktop (or Docker + Docker Compose)
- Node.js 20+
- npm 9+

## Quick Setup

### 1. Install Dependencies

```bash
cd /project/workspace/Vanuan/photo-management
npm install
```

### 2. Build All Packages

```bash
npm run build-all
```

### 3. Start Test Environment

```bash
npm run docker:up
```

Wait for all services to start (about 30-60 seconds).

### 4. Run Tests

```bash
# Run all tests
npm run test:all

# Or run specific test suites
npm run test:integration   # Integration tests only
npm run test:e2e           # E2E tests only
npm run test:performance   # Performance benchmarks
```

## Verify Setup

### Check Services Are Running

```bash
npm run docker:ps
```

Expected output:
```
photo-mgmt-redis           running
photo-mgmt-minio          running
photo-mgmt-storage-service running
photo-mgmt-api-gateway    running
photo-mgmt-worker         running
```

### Check Service Health

```bash
npm run wait-for-services
```

Expected output:
```
✓ Redis is ready
✓ MinIO is ready
✓ Storage Service is responding
✓ API Gateway is responding
```

### Run a Single Test

```bash
npm run test:integration -- -t "should upload, process, and complete a photo"
```

## Common Commands

```bash
# Development
npm run test:watch          # Run tests in watch mode
npm run test:coverage       # Run with coverage report

# Docker management
npm run docker:up           # Start services
npm run docker:down         # Stop and remove services
npm run docker:logs         # View all logs
npm run docker:ps           # Check service status

# Specific test files
npm test tests/integration/photo-upload.test.ts
npm test tests/integration/error-handling.test.ts
npm test tests/performance/upload-benchmark.test.ts
```

## Troubleshooting

### Services Won't Start

```bash
# Stop everything and try again
npm run docker:down
npm run docker:up

# Check Docker logs
npm run docker:logs
```

### Port Conflicts

If you get "port already in use" errors:

```bash
# Check what's using the ports
lsof -i :3000  # API Gateway
lsof -i :3001  # Storage Service
lsof -i :6379  # Redis
lsof -i :9000  # MinIO

# Kill the processes or stop conflicting services
```

### Tests Timing Out

Increase Jest timeout in test files:
```typescript
it('my test', async () => {
  // test code
}, 120000); // 2 minute timeout
```

### Clean Slate

```bash
# Nuclear option - remove everything and start fresh
npm run docker:down
docker system prune -a --volumes
npm run docker:up
```

## Test Output

### Successful Test Run

```
PASS  tests/integration/photo-upload.test.ts
  Photo Upload End-to-End Tests
    Happy Path - Complete Photo Upload Flow
      ✓ should upload, process, and complete a photo (5432ms)
      ✓ should generate and store thumbnails (4123ms)
    Multiple Photo Uploads
      ✓ should handle concurrent uploads (8765ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Time:        18.5 s
```

### Performance Metrics

Look for performance logs in test output:
```
Upload response time: 1234ms
Processing time: 8765ms
WebSocket notification latency: 123ms
Concurrent upload throughput: 12.34 uploads/second
```

## Next Steps

1. **Explore Test Files**
   - `tests/integration/photo-upload.test.ts` - Main E2E tests
   - `tests/integration/error-handling.test.ts` - Error scenarios
   - `tests/performance/upload-benchmark.test.ts` - Benchmarks

2. **Read Documentation**
   - `tests/README.md` - Detailed test documentation
   - `TEST_IMPLEMENTATION_SUMMARY.md` - Implementation details

3. **Write Your Own Tests**
   - Use utilities in `tests/integration/utils/`
   - Follow existing test patterns
   - Add to appropriate test suite

## CI/CD

Tests run automatically on GitHub:
- On every pull request
- On push to main/develop
- Can be triggered manually

View results in GitHub Actions tab.

## Getting Help

- Check logs: `npm run docker:logs`
- Read test output carefully
- Review `tests/README.md` for details
- Check Docker container status: `npm run docker:ps`

## Summary

```bash
# The full workflow
npm install
npm run build-all
npm run docker:up
npm run wait-for-services
npm run test:all
npm run docker:down
```

That's it! You're ready to test the photo management system end-to-end. 🎉
