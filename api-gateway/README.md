# API Gateway Service

The API Gateway service provides a RESTful API for photo management operations, including uploading, processing, and retrieving photos.

## Features

- Photo upload and storage
- Asynchronous photo processing with job queue
- Real-time updates via WebSocket
- Health monitoring and diagnostics

## WebSocket Support

This service includes WebSocket support for real-time communication with clients. See [WEBSOCKET.md](WEBSOCKET.md) for detailed documentation on the WebSocket API.

### Quick Start

To use the WebSocket functionality:

1. Connect to the WebSocket server at the same URL as the HTTP API
2. Include authentication information in the connection options
3. Listen for events to receive real-time updates

Example:
```javascript
const socket = io('http://localhost:3000', {
  auth: {
    clientId: 'your-client-id',
    userId: 'your-user-id'
  }
});

socket.on('photo.processing.completed', (data) => {
  console.log('Photo processing completed:', data);
});
```

See [examples/websocket-client.js](examples/websocket-client.js) for a complete client implementation.

## HTTP API Endpoints

### POST /photos/upload
Upload a photo for processing.

### GET /photos
List all photos.

### GET /photos/:photoId
Retrieve a specific photo.

### GET /photos/:photoId/status
Get the processing status of a photo.

### DELETE /photos/:photoId
Delete a photo.

### GET /health
Get the health status of the service.

## Environment Variables

- `PORT` - Port to listen on (default: 3000)
- `STORAGE_SERVICE_URL` - URL of the storage service
- `REDIS_HOST` - Redis host for event bus and job queue
- `REDIS_PORT` - Redis port
- `MINIO_ENDPOINT` - MinIO endpoint for storage
- `MINIO_PORT` - MinIO port
- `MINIO_ACCESS_KEY` - MinIO access key
- `MINIO_SECRET_KEY` - MinIO secret key
- `ALLOWED_ORIGINS` - Comma-separated list of allowed origins for CORS

## Development

### Building
```bash
npm run build
```

### Running
```bash
npm start
```

### Development Mode
```bash
npm run dev
```
