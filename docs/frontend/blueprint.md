# Client Implementation - Complete Photo Capture Frontend

## Overview

The client-side application is a **mobile-first React application** that provides photo capture, local caching with OPFS (Origin Private File System), background upload with retry logic, real-time status updates via WebSocket, and a responsive queue management UI.

**Key Technologies:**
- React 18+ with Hooks
- OPFS (Origin Private File System) for blob storage
- localStorage for queue metadata
- WebSocket (Socket.IO client) for real-time updates
- XMLHttpRequest for upload progress tracking
- Tailwind CSS for styling

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT APPLICATION                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📷 Photo Capture Layer                                     │
│     ├─ Camera Access (getUserMedia)                         │
│     ├─ Video Preview                                        │
│     ├─ Canvas Capture                                       │
│     └─ Blob Generation (JPEG)                               │
│                                                             │
│  💾 Local Storage Layer                                     │
│     ├─ OPFS Storage (blob files)                            │
│     ├─ localStorage (queue metadata)                        │
│     └─ Fallback to Memory (Map)                             │
│                                                             │
│  📤 Upload Manager                                          │
│     ├─ Upload Queue                                         │
│     ├─ Concurrent Upload Control (max 3)                    │
│     ├─ Progress Tracking (XMLHttpRequest)                   │
│     ├─ Retry Logic (exponential backoff)                    │
│     └─ Network Status Detection                             │
│                                                             │
│  🔌 WebSocket Client                                        │
│     ├─ Connection Management                                │
│     ├─ Client Identification                                │
│     ├─ Event Subscription                                   │
│     └─ Real-time Updates                                    │
│                                                             │
│  🎨 UI Components                                           │
│     ├─ Camera Preview                                       │
│     ├─ Capture Button                                       │
│     ├─ Upload Queue Display                                 │
│     ├─ Progress Indicators                                  │
│     └─ Status Messages                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
client/
├── package.json
├── vite.config.js
├── tailwind.config.js
├── index.html
├── public/
│   └── manifest.json
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── components/
    │   ├── CameraView.jsx
    │   ├── CaptureButton.jsx
    │   ├── UploadQueue.jsx
    │   └── StatusIndicator.jsx
    ├── services/
    │   ├── OPFSStorage.js
    │   ├── UploadManager.js
    │   └── WebSocketClient.js
    ├── hooks/
    │   ├── useCamera.js
    │   ├── useUploadQueue.js
    │   └── useWebSocket.js
    └── utils/
        ├── uuid.js
        └── formatters.js
```

---

## Core Implementation

### 1. package.json

```json
{
  "name": "photo-capture-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "socket.io-client": "^4.7.2"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.3.6",
    "vite": "^5.0.7"
  }
}
```

### 2. src/services/OPFSStorage.js

```javascript
/**
 * OPFS (Origin Private File System) Storage
 * Provides persistent blob storage with fallback to in-memory Map
 */

class OPFSStorage {
  constructor() {
    this.rootHandle = null;
    this.memoryStore = new Map();
    this.isOPFSAvailable = 'storage' in navigator && 'getDirectory' in navigator.storage;
  }

  async initialize() {
    if (!this.isOPFSAvailable) {
      console.warn('OPFS not available, using memory storage');
      return;
    }

    try {
      this.rootHandle = await navigator.storage.getDirectory();
      console.log('OPFS initialized');
    } catch (error) {
      console.error('OPFS initialization failed:', error);
      this.isOPFSAvailable = false;
    }
  }

  async put(id, blob) {
    if (!this.isOPFSAvailable) {
      this.memoryStore.set(id, blob);
      return true;
    }

    try {
      const photosDir = await this.rootHandle.getDirectoryHandle('photos', { create: true });
      const fileHandle = await photosDir.getFileHandle(`${id}.jpg`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      console.error('OPFS put failed:', error);
      // Fallback to memory
      this.memoryStore.set(id, blob);
      return true;
    }
  }

  async get(id) {
    if (!this.isOPFSAvailable) {
      return this.memoryStore.get(id) || null;
    }

    try {
      const photosDir = await this.rootHandle.getDirectoryHandle('photos');
      const fileHandle = await photosDir.getFileHandle(`${id}.jpg`);
      const file = await fileHandle.getFile();
      return file;
    } catch (error) {
      // Try memory fallback
      return this.memoryStore.get(id) || null;
    }
  }

  async remove(id) {
    if (!this.isOPFSAvailable) {
      this.memoryStore.delete(id);
      return true;
    }

    try {
      const photosDir = await this.rootHandle.getDirectoryHandle('photos');
      await photosDir.removeEntry(`${id}.jpg`);
      return true;
    } catch (error) {
      console.warn('OPFS remove failed:', error);
      this.memoryStore.delete(id);
      return true;
    }
  }

  async getUsage() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      return await navigator.storage.estimate();
    }
    return { usage: 0, quota: 0 };
  }
}

export const opfsStorage = new OPFSStorage();
```

### 3. src/services/UploadManager.js

```javascript
import { opfsStorage } from './OPFSStorage';

const LS_QUEUE_KEY = 'photo_capture_queue_v2';

class UploadManager {
  constructor({
    onChange,
    apiUrl = '/api/photos/upload',
    wsUrl = 'http://localhost:3000'
  }) {
    this.queue = this.loadQueue();
    this.concurrency = 3;
    this.running = 0;
    this.onChange = onChange;
    this.apiUrl = apiUrl;
    this.wsUrl = wsUrl;
    this.processingLoop = null;
    this.userId = this.getUserId();

    // Start processing
    setTimeout(() => this.startProcessing(), 1000);

    // Resume on network reconnect
    window.addEventListener('online', () => {
      console.log('Network online - resuming uploads');
      this.startProcessing();
    });
  }

  getUserId() {
    let userId = localStorage.getItem('user_id');
    if (!userId) {
      userId = this.generateUUID();
      localStorage.setItem('user_id', userId);
    }
    return userId;
  }

  loadQueue() {
    try {
      const raw = localStorage.getItem(LS_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error('Failed to load queue:', error);
      return [];
    }
  }

  saveQueue() {
    try {
      localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save queue:', error);
    }
  }

  getQueue() {
    return [...this.queue];
  }

  addToQueue(item) {
    this.queue.unshift(item);
    this.saveQueue();
    this.notifyChange();
    this.startProcessing();
  }

  updateItem(id, updates) {
    const idx = this.queue.findIndex(q => q.id === id);
    if (idx < 0) return;

    this.queue[idx] = { ...this.queue[idx], ...updates };
    this.saveQueue();
    this.notifyChange();
  }

  removeItem(id) {
    this.queue = this.queue.filter(q => q.id !== id);
    this.saveQueue();
    this.notifyChange();
  }

  notifyChange() {
    if (this.onChange) {
      this.onChange(this.getQueue());
    }
  }

  async startProcessing() {
    if (this.processingLoop) return;

    this.processingLoop = setInterval(() => {
      this.processNextInQueue();
    }, 500);

    this.processNextInQueue();
  }

  async processNextInQueue() {
    if (!navigator.onLine) {
      console.log('Offline - waiting for connection');
      return;
    }

    while (this.running < this.concurrency) {
      const next = this.queue.find(
        q => q.status === 'cached' || q.status === 'error'
      );

      if (!next) break;

      this.uploadItem(next);
    }
  }

  async uploadItem(item) {
    if (this.running >= this.concurrency) return;

    this.running++;
    this.updateItem(item.id, {
      status: 'uploading',
      progress: 0,
      retryCount: (item.retryCount || 0) + 1
    });

    try {
      const blob = await opfsStorage.get(item.id);
      if (!blob) {
        throw new Error('Photo blob not found in storage');
      }

      const result = await this.uploadWithProgress(item, blob, (progress) => {
        this.updateItem(item.id, { progress });
      });

      console.log('Upload successful:', result);

      // Clean up OPFS storage
      await opfsStorage.remove(item.id);

      // Mark as uploaded with photoId from API response
      this.updateItem(item.id, {
        status: 'uploaded',
        progress: 100,
        uploadedAt: new Date().toISOString(),
        photoId: result.photoId, // From API response
        userId: result.userId
      });

      // Remove from queue after 2 seconds
      setTimeout(() => this.removeItem(item.id), 2000);

    } catch (error) {
      console.error('Upload failed:', error);

      const maxRetries = 5;
      const retryCount = item.retryCount || 1;

      if (retryCount >= maxRetries) {
        this.updateItem(item.id, {
          status: 'failed',
          error: `Failed after ${maxRetries} attempts: ${error.message}`
        });
      } else {
        this.updateItem(item.id, {
          status: 'error',
          error: error.message,
          retryCount
        });

        const delay = Math.min(2000 * Math.pow(2, retryCount - 1), 32000);
        setTimeout(() => this.processNextInQueue(), delay);
      }

    } finally {
      this.running--;
    }
  }

  uploadWithProgress(item, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', this.apiUrl);
      xhr.responseType = 'json';

      // Set headers for API server
      xhr.setRequestHeader('X-User-ID', this.userId);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          onProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          let errorMessage = `Upload failed with status ${xhr.status}`;
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            errorMessage = errorResponse.message || errorMessage;
          } catch (e) {
            // Use default error message
          }
          reject(new Error(errorMessage));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload'));
      };

      xhr.ontimeout = () => {
        reject(new Error('Upload timeout'));
      };

      xhr.timeout = 60000;

      const formData = new FormData();
      formData.append('photo', blob, item.filename);
      formData.append('timestamp', new Date().toISOString());

      xhr.send(formData);
    });
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  getStats() {
    return {
      total: this.queue.length,
      cached: this.queue.filter(q => q.status === 'cached').length,
      uploading: this.queue.filter(q => q.status === 'uploading').length,
      uploaded: this.queue.filter(q => q.status === 'uploaded').length,
      error: this.queue.filter(q => q.status === 'error').length,
      failed: this.queue.filter(q => q.status === 'failed').length
    };
  }

  stop() {
    if (this.processingLoop) {
      clearInterval(this.processingLoop);
      this.processingLoop = null;
    }
  }
}

export default UploadManager;
```

### 4. src/services/WebSocketClient.js

```javascript
import { io } from 'socket.io-client';

class WebSocketClient {
  constructor({ url, onEvent }) {
    this.url = url;
    this.socket = null;
    this.isConnected = false;
    this.onEvent = onEvent;
    this.userId = this.getUserId();
  }

  connect() {
    this.socket = io(this.url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      auth: {
        userId: this.userId
      }
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected:', this.socket.id);
      this.isConnected = true;

      // Subscribe to user-specific events
      this.socket.emit('subscribe', {
        userId: this.userId,
        channels: ['photo.status.updated']
      });
    });

    this.socket.on('photo.status.updated', (event) => {
      console.log('Photo status update:', event);
      if (this.onEvent) {
        this.onEvent({
          type: 'photo.status.updated',
          data: event
        });
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.isConnected = false;
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  getUserId() {
    let userId = localStorage.getItem('user_id');
    if (!userId) {
      userId = this.generateUUID();
      localStorage.setItem('user_id', userId);
    }
    return userId;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Method to manually check photo status
  async checkPhotoStatus(photoId) {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket.emit('get_photo_status', { photoId }, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }
}

export default WebSocketClient;
```

### 4. PhotoService.js

class PhotoService {
  constructor({ baseUrl = '/api' }) {
    this.baseUrl = baseUrl;
    this.userId = this.getUserId();
  }

  getUserId() {
    let userId = localStorage.getItem('user_id');
    if (!userId) {
      userId = this.generateUUID();
      localStorage.setItem('user_id', userId);
    }
    return userId;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-User-ID': this.userId
    };
  }

  async listPhotos(limit = 20, offset = 0) {
    try {
      const response = await fetch(
        `${this.baseUrl}/photos?limit=${limit}&offset=${offset}`,
        {
          headers: await this.getHeaders()
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch photos: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error listing photos:', error);
      throw error;
    }
  }

  async getPhoto(photoId) {
    try {
      const response = await fetch(`${this.baseUrl}/photos/${photoId}`, {
        headers: await this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch photo: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting photo:', error);
      throw error;
    }
  }

  async getPhotoStatus(photoId) {
    try {
      const response = await fetch(`${this.baseUrl}/photos/${photoId}/status`, {
        headers: await this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch photo status: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting photo status:', error);
      throw error;
    }
  }

  async deletePhoto(photoId) {
    try {
      const response = await fetch(`${this.baseUrl}/photos/${photoId}`, {
        method: 'DELETE',
        headers: await this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to delete photo: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error('Error deleting photo:', error);
      throw error;
    }
  }

  async getHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error checking health:', error);
      throw error;
    }
  }
}

export default PhotoService;


4. App.tsx


import React, { useState, useEffect, useCallback } from 'react';
import CameraView from './components/CameraView';
import UploadQueue from './components/UploadQueue';
import StatusIndicator from './components/StatusIndicator';
import UploadManager from './services/UploadManager';
import WebSocketClient from './services/WebSocketClient';
import PhotoService from './services/PhotoService';
import { opfsStorage } from './services/OPFSStorage';

function App() {
  const [uploadQueue, setUploadQueue] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [systemStatus, setSystemStatus] = useState('loading');
  const [lastEvent, setLastEvent] = useState(null);
  const [uploadManager, setUploadManager] = useState(null);
  const [wsClient, setWsClient] = useState(null);
  const [photoService, setPhotoService] = useState(null);

  // Initialize services
  useEffect(() => {
    const initializeServices = async () => {
      try {
        // Initialize OPFS storage
        await opfsStorage.initialize();

        // Initialize upload manager
        const um = new UploadManager({
          onChange: setUploadQueue,
          apiUrl: '/api/photos/upload',
          wsUrl: 'http://localhost:3000'
        });

        // Initialize WebSocket client
        const ws = new WebSocketClient({
          url: 'http://localhost:3000',
          onEvent: (event) => {
            console.log('WebSocket event:', event);
            setLastEvent(event);

            // Handle photo status updates
            if (event.type === 'photo.status.updated') {
              // Update local state or refetch photos if needed
              handlePhotoStatusUpdate(event.data);
            }
          }
        });

        // Initialize photo service
        const ps = new PhotoService({ baseUrl: '/api' });

        setUploadManager(um);
        setWsClient(ws);
        setPhotoService(ps);

        // Connect WebSocket
        ws.connect();

        // Load existing photos
        await loadPhotos(ps);

        setSystemStatus('ready');
      } catch (error) {
        console.error('Failed to initialize services:', error);
        setSystemStatus('error');
      }
    };

    initializeServices();

    return () => {
      if (uploadManager) {
        uploadManager.stop();
      }
      if (wsClient) {
        wsClient.disconnect();
      }
    };
  }, []);

  const loadPhotos = async (ps) => {
    try {
      const result = await ps.listPhotos(20, 0);
      setPhotos(result.photos || []);
    } catch (error) {
      console.error('Failed to load photos:', error);
    }
  };

  const handlePhotoStatusUpdate = (update) => {
    // Update local photos state if we have the photo
    setPhotos(prevPhotos =>
      prevPhotos.map(photo =>
        photo.id === update.photoId
          ? { ...photo, processingStatus: update.status }
          : photo
      )
    );
  };

  const handlePhotoCapture = useCallback(async (blob, filename) => {
    if (!uploadManager) return;

    const photoId = uploadManager.generateUUID();
    const timestamp = new Date().toISOString();

    // Store in OPFS
    await opfsStorage.put(photoId, blob);

    // Add to upload queue
    uploadManager.addToQueue({
      id: photoId,
      filename,
      timestamp,
      status: 'cached',
      progress: 0,
      size: blob.size
    });
  }, [uploadManager]);

  const handleRetryUpload = (itemId) => {
    if (uploadManager) {
      uploadManager.updateItem(itemId, { status: 'cached', error: null });
      uploadManager.startProcessing();
    }
  };

  const handleDeletePhoto = async (photoId) => {
    if (!photoService) return;

    try {
      await photoService.deletePhoto(photoId);
      // Remove from local state
      setPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (error) {
      console.error('Failed to delete photo:', error);
    }
  };

  const handleRefreshPhotos = async () => {
    if (photoService) {
      await loadPhotos(photoService);
    }
  };

  if (systemStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Initializing application...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 text-center">
            Photo Capture App
          </h1>
          <StatusIndicator
            uploadManager={uploadManager}
            wsClient={wsClient}
            lastEvent={lastEvent}
          />
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Camera Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Camera</h2>
            <CameraView onPhotoCapture={handlePhotoCapture} />
          </div>

          {/* Upload Queue Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Upload Queue</h2>
            <UploadQueue
              queue={uploadQueue}
              onRetry={handleRetryUpload}
            />
          </div>

          {/* Photo Gallery Section */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Your Photos</h2>
              <button
                onClick={handleRefreshPhotos}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Refresh
              </button>
            </div>

            {photos.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No photos yet. Capture some photos to see them here!
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {photos.map(photo => (
                  <div key={photo.id} className="border rounded-lg overflow-hidden">
                    {photo.url ? (
                      <img
                        src={photo.url}
                        alt={photo.filename}
                        className="w-full h-32 object-cover"
                      />
                    ) : (
                      <div className="w-full h-32 bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-500">Processing...</span>
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-sm font-medium truncate">{photo.filename}</p>
                      <p className="text-xs text-gray-500 capitalize">
                        {photo.processingStatus?.replace('_', ' ')}
                      </p>
                      <div className="mt-2 flex justify-between items-center">
                        <span className="text-xs text-gray-500">
                          {new Date(photo.uploadTimestamp).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => handleDeletePhoto(photo.id)}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
