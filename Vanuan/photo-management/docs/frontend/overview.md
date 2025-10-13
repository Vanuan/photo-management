# Photo Capture Frontend Documentation

## Overview
Mobile-first React application for photo capture with offline-first architecture, featuring local caching, background uploads, and real-time status updates.

## Core Architecture

### Technology Stack
- **Frontend**: React 18+ with Hooks
- **Storage**: OPFS (Origin Private File System) + localStorage fallback
- **Communication**: WebSocket (Socket.IO) + REST API
- **Styling**: Tailwind CSS
- **Build Tool**: Vite

### Key Features
1. **Photo Capture** - Camera access via getUserMedia with canvas capture
2. **Local Storage** - OPFS for blob storage with memory fallback
3. **Upload Management** - Concurrent uploads with retry logic and progress tracking
4. **Real-time Updates** - WebSocket connection for live status updates
5. **Queue Management** - Visual upload queue with status indicators

## Service Layer

### OPFSStorage
- Provides persistent blob storage using Origin Private File System
- Automatic fallback to in-memory Map when OPFS unavailable
- Methods: `put()`, `get()`, `remove()`, `getUsage()`

### UploadManager
- Manages upload queue with concurrency control (max 3 simultaneous)
- Implements exponential backoff retry logic
- Tracks progress via XMLHttpRequest upload events
- Persists queue state to localStorage
- Handles network status detection and resume on reconnect

### WebSocketClient
- Maintains real-time connection to server
- Client identification and event subscription
- Handles photo status updates and connection management

### PhotoService
- REST API client for photo management operations
- Methods: `listPhotos()`, `getPhoto()`, `deletePhoto()`, `getHealth()`

## Component Structure

### Main Components
- **CameraView** - Camera preview and capture functionality
- **UploadQueue** - Displays upload progress and status
- **StatusIndicator** - Shows system and connection status
- **App** - Main container coordinating all services and state

## Data Flow
1. Photo captured → stored in OPFS → added to upload queue
2. UploadManager processes queue → uploads with progress tracking
3. Successful upload → blob removed from OPFS → item marked complete
4. WebSocket receives status updates → UI updates in real-time
5. Failed uploads → retry with exponential backoff

## Key Implementation Details

### Offline-First Design
- Photos cached locally until successful upload
- Queue persists across browser sessions
- Automatic resume when connection restored

### Error Handling
- Multiple retry attempts with increasing delays
- Graceful degradation when OPFS unavailable
- Network status monitoring

### Performance
- Concurrent upload limiting prevents network congestion
- Efficient blob storage management
- Real-time updates without page refresh
