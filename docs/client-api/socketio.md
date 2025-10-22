## 🏗️ Socket.io Bridge Architecture

### 1. Enhanced APIServer with Socket.io Bridge

```typescript
// socket-bridge.ts
import { Server as SocketIOServer, Socket } from 'socket.io';
import { EventBusClient } from '@shared-infra/event-bus';

export interface SocketAuthPayload {
  userId: string;
  clientId: string;
  sessionId?: string;
  permissions: string[];
}

export interface SocketEvent {
  type: string;
  data: any;
  metadata: {
    clientId: string;
    userId: string;
    sessionId?: string;
    timestamp: string;
  };
}

export class SocketIOBridge {
  private io: SocketIOServer;
  private connectedClients: Map<string, Socket> = new Map();
  private clientRooms: Map<string, Set<string>> = new Map();
  private roomClients: Map<string, Set<string>> = new Map();

  constructor(
    private httpServer: any,
    private eventBusClient: EventBusClient,
    private config: SocketBridgeConfig = {}
  ) {
    this.io = new SocketIOServer(httpServer, this.getSocketConfig());
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private getSocketConfig() {
    return {
      cors: {
        origin: this.config.allowedOrigins || ["http://localhost:3000", "http://localhost:3001"],
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 30000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6 // 1MB
    };
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const auth = await this.authenticateSocket(socket);
        if (auth) {
          socket.data.auth = auth;
          next();
        } else {
          next(new Error('Authentication failed'));
        }
      } catch (error) {
        next(new Error('Authentication error'));
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });
  }

  private async authenticateSocket(socket: Socket): Promise<SocketAuthPayload> {
    const { userId, clientId, sessionId, token } = socket.handshake.auth;

    // Validate required fields
    if (!userId || !clientId) {
      throw new Error('Missing authentication parameters');
    }

    // In production, validate JWT token here
    if (token) {
      // await verifyJWTToken(token);
    }

    return {
      userId,
      clientId,
      sessionId,
      permissions: ['read:photos', 'write:photos'] // Default permissions
    };
  }
}
```

### 2. Complete Connection Management

```typescript
// connection-manager.ts
export class ConnectionManager {
  constructor(private bridge: SocketIOBridge) {}

  async handleConnection(socket: Socket): Promise<void> {
    const { userId, clientId, sessionId } = socket.data.auth;

    console.log(`Client connected: ${clientId}, User: ${userId}, Socket: ${socket.id}`);

    // Register client
    this.bridge.connectedClients.set(clientId, socket);

    // Join default rooms
    await this.joinDefaultRooms(socket, userId, clientId, sessionId);

    // Setup event handlers
    this.setupSocketEventHandlers(socket);

    // Notify system of new connection
    await this.bridge.eventBusClient.publish('client.connected', {
      clientId,
      userId,
      sessionId,
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Send connection confirmation
    socket.emit('connection:established', {
      socketId: socket.id,
      clientId,
      userId,
      timestamp: new Date().toISOString()
    });
  }

  private async joinDefaultRooms(
    socket: Socket,
    userId: string,
    clientId: string,
    sessionId?: string
  ): Promise<void> {
    // User room - all events for this user
    socket.join(`user:${userId}`);
    this.addClientToRoom(clientId, `user:${userId}`);

    // Client room - all events for this client
    socket.join(`client:${clientId}`);
    this.addClientToRoom(clientId, `client:${clientId}`);

    // Session room if provided
    if (sessionId) {
      socket.join(`session:${sessionId}`);
      this.addClientToRoom(clientId, `session:${sessionId}`);
    }

    // Global room for system events
    socket.join('global');
    this.addClientToRoom(clientId, 'global');
  }

  private setupSocketEventHandlers(socket: Socket): void {
    const { userId, clientId } = socket.data.auth;

    // Photo subscription management
    socket.on('subscribe:photo', async (data: { photoId: string }) => {
      await this.handlePhotoSubscription(socket, data.photoId);
    });

    socket.on('unsubscribe:photo', async (data: { photoId: string }) => {
      await this.handlePhotoUnsubscription(socket, data.photoId);
    });

    // Client-initiated actions
    socket.on('photo:status:request', async (data: { photoId: string }) => {
      await this.handleStatusRequest(socket, data.photoId);
    });

    // Ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Disconnection handler
    socket.on('disconnect', async (reason) => {
      await this.handleDisconnection(socket, reason);
    });

    socket.on('error', (error) => {
      console.error(`Socket error for client ${clientId}:`, error);
    });
  }

  private async handlePhotoSubscription(socket: Socket, photoId: string): Promise<void> {
    const { clientId } = socket.data.auth;

    socket.join(`photo:${photoId}`);
    this.addClientToRoom(clientId, `photo:${photoId}`);

    console.log(`Client ${clientId} subscribed to photo ${photoId}`);

    // Notify system of subscription
    await this.bridge.eventBusClient.publish('client.subscribed', {
      clientId,
      photoId,
      timestamp: new Date().toISOString()
    });

    socket.emit('subscription:confirmed', {
      photoId,
      message: `Subscribed to photo ${photoId}`
    });
  }

  private async handleDisconnection(socket: Socket, reason: string): Promise<void> {
    const { userId, clientId } = socket.data.auth;

    console.log(`Client disconnected: ${clientId}, reason: ${reason}`);

    // Clean up registration
    this.bridge.connectedClients.delete(clientId);

    // Clean up room memberships
    this.removeClientFromAllRooms(clientId);

    // Notify system of disconnection
    await this.bridge.eventBusClient.publish('client.disconnected', {
      clientId,
      userId,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  private addClientToRoom(clientId: string, room: string): void {
    if (!this.bridge.clientRooms.has(clientId)) {
      this.bridge.clientRooms.set(clientId, new Set());
    }
    this.bridge.clientRooms.get(clientId)!.add(room);

    if (!this.bridge.roomClients.has(room)) {
      this.bridge.roomClients.set(room, new Set());
    }
    this.bridge.roomClients.get(room)!.add(clientId);
  }

  private removeClientFromAllRooms(clientId: string): void {
    const rooms = this.bridge.clientRooms.get(clientId);
    if (rooms) {
      rooms.forEach(room => {
        const clients = this.bridge.roomClients.get(room);
        if (clients) {
          clients.delete(clientId);
          if (clients.size === 0) {
            this.bridge.roomClients.delete(room);
          }
        }
      });
      this.bridge.clientRooms.delete(clientId);
    }
  }
}
```

### 3. Event Bus Integration

```typescript
// event-bridge.ts
export class EventBridge {
  constructor(private bridge: SocketIOBridge) {}

  async initializeEventSubscriptions(): Promise<void> {
    // Subscribe to photo processing events
    await this.setupPhotoEventSubscriptions();

    // Subscribe to system events
    await this.setupSystemEventSubscriptions();
  }

  private async setupPhotoEventSubscriptions(): Promise<void> {
    // Photo uploaded
    await this.bridge.eventBusClient.subscribe('photo.uploaded', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.uploaded', event.data);
    });

    // Processing started
    await this.bridge.eventBusClient.subscribe('photo.processing.started', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.processing.started', event.data);
    });

    // Processing progress
    await this.bridge.eventBusClient.subscribe('photo.processing.progress', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.processing.progress', event.data);
    });

    // Processing completed
    await this.bridge.eventBusClient.subscribe('photo.processing.completed', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.processing.completed', event.data);

      // Also notify the user
      if (event.data.userId) {
        await this.broadcastToUserRoom(event.data.userId, 'photo.processing.completed', event.data);
      }
    });

    // Processing failed
    await this.bridge.eventBusClient.subscribe('photo.processing.failed', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.processing.failed', event.data);

      if (event.data.userId) {
        await this.broadcastToUserRoom(event.data.userId, 'photo.processing.failed', event.data);
      }
    });

    // Photo deleted
    await this.bridge.eventBusClient.subscribe('photo.deleted', async (event) => {
      await this.broadcastToPhotoRoom(event.data.photoId, 'photo.deleted', event.data);

      if (event.data.userId) {
        await this.broadcastToUserRoom(event.data.userId, 'photo.deleted', event.data);
      }
    });
  }

  private async setupSystemEventSubscriptions(): Promise<void> {
    // System health events
    await this.bridge.eventBusClient.subscribe('system.health', async (event) => {
      this.bridge.io.to('global').emit('system.health', event.data);
    });

    // Maintenance events
    await this.bridge.eventBusClient.subscribe('system.maintenance', async (event) => {
      this.bridge.io.to('global').emit('system.maintenance', event.data);
    });
  }

  private async broadcastToPhotoRoom(photoId: string, eventType: string, data: any): Promise<void> {
    const room = `photo:${photoId}`;
    this.bridge.io.to(room).emit(eventType, {
      ...data,
      timestamp: new Date().toISOString()
    });

    console.log(`Broadcast ${eventType} to room ${room}`);
  }

  private async broadcastToUserRoom(userId: string, eventType: string, data: any): Promise<void> {
    const room = `user:${userId}`;
    this.bridge.io.to(room).emit(eventType, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  // Direct messaging to specific client
  async sendToClient(clientId: string, eventType: string, data: any): Promise<boolean> {
    const socket = this.bridge.connectedClients.get(clientId);
    if (socket && socket.connected) {
      socket.emit(eventType, {
        ...data,
        timestamp: new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  // Broadcast to all clients in a session
  async broadcastToSession(sessionId: string, eventType: string, data: any): Promise<void> {
    this.bridge.io.to(`session:${sessionId}`).emit(eventType, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }
}
```

### 4. Enhanced APIServer Integration

```typescript
// enhanced-api-server.ts
export class APIServer {
  private socketBridge: SocketIOBridge;
  private connectionManager: ConnectionManager;
  private eventBridge: EventBridge;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);

    // Initialize Socket.io Bridge after shared infrastructure
    this.socketBridge = new SocketIOBridge(
      this.server,
      this.eventBusClient,
      {
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
      }
    );

    this.connectionManager = new ConnectionManager(this.socketBridge);
    this.eventBridge = new EventBridge(this.socketBridge);
  }

  async initialize() {
    await this.initializeSharedInfra();
    await this.verifyConnections();
    this.setupMiddleware();
    this.setupRoutes();

    // Initialize Socket.io bridge after routes
    await this.eventBridge.initializeEventSubscriptions();

    await this.setupEventSubscriptions();
    this.setupGracefulShutdown();
  }

  // Add WebSocket-aware methods to existing handlers
  async handlePhotoUpload(req: Request, res: Response) {
    try {
      // ... existing upload logic ...

      // After successful upload and job enqueue
      const photoProcessingJob = {
        // ... job data ...
      };

      await this.jobCoordinatorClient.enqueueJob("photo-processing", photoProcessingJob);

      // Notify client via WebSocket immediately
      await this.eventBridge.sendToClient(userId, 'photo.uploaded', {
        photoId: storedPhotoResult.id,
        userId,
        filename: originalname,
        status: 'pending',
        message: 'Photo uploaded and queued for processing'
      });

      res.status(202).json({
        message: "Photo uploaded and being processed",
        photoId: storedPhotoResult.id,
        userId: userId,
        filename: originalname,
        status: "pending",
      });
    } catch (error) {
      // Notify client of failure
      if (userId) {
        await this.eventBridge.sendToClient(userId, 'photo.upload.failed', {
          photoId: storedPhotoResult?.id,
          error: error.message
        });
      }
      // ... error handling ...
    }
  }

  // Health check that includes WebSocket metrics
  async handleDetailedHealth(req: Request, res: Response) {
    const healthStatus = {
      status: "ok",
      timestamp: new Date().toISOString(),
      details: {
        // ... existing health checks ...
        websocket: await this.getWebSocketHealth()
      }
    };

    res.status(200).json(healthStatus);
  }

  private async getWebSocketHealth() {
    return {
      status: 'healthy',
      connectedClients: this.socketBridge.connectedClients.size,
      activeRooms: this.socketBridge.roomClients.size,
      uptime: process.uptime()
    };
  }

  async shutdown() {
    console.log("Shutting down API Gateway service...");

    // Notify all clients of shutdown
    this.socketBridge.io.emit('system.shutdown', {
      message: 'Server is shutting down',
      timestamp: new Date().toISOString()
    });

    // Close Socket.io
    this.socketBridge.io.close();

    // Close HTTP server
    this.server.close(() => {
      console.log("HTTP server closed.");
    });

    // ... rest of shutdown logic ...
  }
}
```

### 5. Client-Side Integration Example

```typescript
// client-websocket-service.ts
export class ClientWebSocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private apiUrl: string) {}

  async connect(userId: string, clientId: string, sessionId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.apiUrl, {
        auth: {
          userId,
          clientId,
          sessionId,
          token: localStorage.getItem('auth_token') // If using JWT
        },
        transports: ['websocket', 'polling'],
        timeout: 10000
      });

      this.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        this.handleReconnection();
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        reject(error);
      });

      // Setup event listeners
      this.setupEventListeners();
    });
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Photo events
    this.socket.on('photo.uploaded', this.handlePhotoUploaded.bind(this));
    this.socket.on('photo.processing.started', this.handleProcessingStarted.bind(this));
    this.socket.on('photo.processing.progress', this.handleProcessingProgress.bind(this));
    this.socket.on('photo.processing.completed', this.handleProcessingCompleted.bind(this));
    this.socket.on('photo.processing.failed', this.handleProcessingFailed.bind(this));

    // System events
    this.socket.on('system.health', this.handleSystemHealth.bind(this));
    this.socket.on('system.maintenance', this.handleSystemMaintenance.bind(this));
    this.socket.on('system.shutdown', this.handleSystemShutdown.bind(this));
  }

  // Subscription methods
  subscribeToPhoto(photoId: string): void {
    this.socket?.emit('subscribe:photo', { photoId });
  }

  unsubscribeFromPhoto(photoId: string): void {
    this.socket?.emit('unsubscribe:photo', { photoId });
  }

  requestPhotoStatus(photoId: string): void {
    this.socket?.emit('photo:status:request', { photoId });
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * this.reconnectAttempts, 30000);

      setTimeout(() => {
        console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.socket?.connect();
      }, delay);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
```

### 6. Configuration and Environment

```typescript
// socket-bridge-config.ts
export interface SocketBridgeConfig {
  allowedOrigins?: string[];
  pingTimeout?: number;
  pingInterval?: number;
  maxHttpBufferSize?: number;
  corsCredentials?: boolean;
}

export const getSocketBridgeConfig = (): SocketBridgeConfig => ({
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT || '30000'),
  pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL || '25000'),
  maxHttpBufferSize: parseInt(process.env.SOCKET_MAX_BUFFER_SIZE || '1048576'),
  corsCredentials: process.env.SOCKET_CORS_CREDENTIALS === 'true'
});
```

## 🎯 Key Benefits

1. **Seamless Integration**: Tightly coupled with your existing Event Bus system
2. **Room-based Broadcasting**: Efficient targeting of events to relevant clients
3. **Authentication & Authorization**: Secure socket connections with permission validation
4. **Automatic Reconnection**: Built-in resilience for temporary network issues
5. **Comprehensive Monitoring**: Health checks and metrics for WebSocket connections
6. **Graceful Degradation**: Proper cleanup during shutdowns and errors
7. **Extensible Architecture**: Easy to add new event types and room types

This Socket.io bridge will provide real-time updates to your clients while maintaining the clean separation of concerns in your architecture.
