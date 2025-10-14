# WebSocket API Documentation

This document describes the WebSocket API implemented in the API Gateway service for real-time communication with clients.

## Overview

The API Gateway service uses Socket.io to provide real-time updates to clients about photo processing status and other events. Clients can connect to the WebSocket server and receive immediate notifications when events occur.

## Connection

To connect to the WebSocket server, clients should use the same base URL as the HTTP API but with a WebSocket connection:

```
ws://localhost:3000
```

### Authentication

Clients can provide authentication information when connecting by including it in the `auth` option:

```javascript
const socket = io('ws://localhost:3000', {
  auth: {
    clientId: 'client-123',
    userId: 'user-456',
    sessionId: 'session-789'
  }
});
```

When a client connects with authentication information, they are automatically joined to rooms based on their identifiers:
- `client:{clientId}` - For client-specific messages
- `user:{userId}` - For user-specific messages
- `session:{sessionId}` - For session-specific messages

## Events

### Client to Server

#### `connection`
Emitted when a client successfully connects to the WebSocket server.

#### `disconnect`
Emitted when a client disconnects from the WebSocket server.

### Server to Client

#### `photo.uploaded`
Emitted when a photo is successfully uploaded and queued for processing.

```json
{
  "photoId": "uuid-of-photo",
  "filename": "example.jpg",
  "status": "queued",
  "jobId": "uuid-of-job",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `photo.upload.failed`
Emitted when a photo upload fails.

```json
{
  "error": "Error message",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `photo.processing.started`
Emitted when photo processing begins.

```json
{
  "photoId": "uuid-of-photo",
  "status": "processing",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `photo.processing.completed`
Emitted when photo processing is completed successfully.

```json
{
  "photoId": "uuid-of-photo",
  "status": "completed",
  "results": {
    // Processing results
  },
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `photo.processing.failed`
Emitted when photo processing fails.

```json
{
  "photoId": "uuid-of-photo",
  "status": "failed",
  "error": "Error message",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `photo.processing.progress`
Emitted periodically during photo processing to indicate progress.

```json
{
  "photoId": "uuid-of-photo",
  "status": "in_progress",
  "progress": 50,
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

#### `system.maintenance`
Emitted when the server is shutting down for maintenance.

```json
{
  "message": "Server is shutting down for maintenance",
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

## Client Implementation Example

Here's an example of how to implement a client that uses the WebSocket API:

```javascript
const io = require('socket.io-client');

// Connect to the WebSocket server
const socket = io('http://localhost:3000', {
  auth: {
    clientId: 'my-client-id',
    userId: 'my-user-id'
  }
});

// Listen for connection
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

// Listen for photo upload events
socket.on('photo.uploaded', (data) => {
  console.log('Photo uploaded:', data);
});

// Listen for photo processing completion
socket.on('photo.processing.completed', (data) => {
  console.log('Photo processing completed:', data);
});

// Listen for photo processing failures
socket.on('photo.processing.failed', (data) => {
  console.log('Photo processing failed:', data);
});

// Listen for system maintenance events
socket.on('system.maintenance', (data) => {
  console.log('System maintenance:', data);
});

// Handle disconnection
socket.on('disconnect', () => {
  console.log('Disconnected from WebSocket server');
});
```

## Health Check

The health check endpoint (`/health`) now includes WebSocket metrics:

```json
{
  "status": "ok",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "details": {
    "websocket": {
      "status": "healthy",
      "connectedClients": 5,
      "activeRooms": 10
    }
    // ... other health details
  }
}
```

## Implementation Details

The WebSocket implementation is integrated with the existing event-driven architecture:

1. When clients connect, they're joined to appropriate rooms based on their authentication information
2. Event subscriptions in the API server now broadcast events via WebSocket in addition to updating storage
3. The photo upload handler sends immediate WebSocket notifications
4. Health checks include WebSocket connection metrics
5. Graceful shutdown notifies connected clients before closing connections

This dual communication approach (HTTP + WebSocket) provides clients with immediate updates while maintaining backward compatibility with existing HTTP-only clients.