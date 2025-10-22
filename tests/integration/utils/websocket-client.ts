import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';

export interface PhotoEvent {
  type: string;
  photoId: string;
  userId?: string;
  status?: string;
  progress?: number;
  message?: string;
  timestamp?: string;
  error?: any;
}

/**
 * WebSocket client for testing real-time photo events
 */
export class WebSocketClient extends EventEmitter {
  private socket: Socket | null = null;
  private connected: boolean = false;
  private events: PhotoEvent[] = [];
  private userId: string;

  constructor(private url: string, userId: string = 'test-user') {
    super();
    this.userId = userId;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.url, {
        transports: ['websocket'],
        auth: {
          userId: this.userId,
        },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        console.log('WebSocket connected');
        resolve();
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        console.log('WebSocket disconnected');
      });

      this.socket.on('connect_error', (error: Error) => {
        console.error('WebSocket connection error:', error);
        reject(error);
      });

      // Listen for photo events
      this.socket.on('photo.uploaded', (data: any) => {
        this.handleEvent('photo.uploaded', data);
      });

      this.socket.on('photo.processing.started', (data: any) => {
        this.handleEvent('photo.processing.started', data);
      });

      this.socket.on('photo.processing.progress', (data: any) => {
        this.handleEvent('photo.processing.progress', data);
      });

      this.socket.on('photo.processing.completed', (data: any) => {
        this.handleEvent('photo.processing.completed', data);
      });

      this.socket.on('photo.processing.failed', (data: any) => {
        this.handleEvent('photo.processing.failed', data);
      });

      this.socket.on('photo.status.updated', (data: any) => {
        this.handleEvent('photo.status.updated', data);
      });

      this.socket.on('photo.deleted', (data: any) => {
        this.handleEvent('photo.deleted', data);
      });

      // Timeout if connection takes too long
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Handle incoming event
   */
  private handleEvent(type: string, data: any): void {
    const event: PhotoEvent = {
      type,
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    };

    this.events.push(event);
    this.emit('event', event);
    this.emit(type, event);
  }

  /**
   * Disconnect from WebSocket server
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get all received events
   */
  getEvents(): PhotoEvent[] {
    return [...this.events];
  }

  /**
   * Get events by type
   */
  getEventsByType(type: string): PhotoEvent[] {
    return this.events.filter(event => event.type === type);
  }

  /**
   * Get events for a specific photo
   */
  getEventsForPhoto(photoId: string): PhotoEvent[] {
    return this.events.filter(event => event.photoId === photoId);
  }

  /**
   * Clear event history
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Wait for a specific event
   */
  async waitForEvent(
    type: string,
    timeoutMs: number = 30000,
    filter?: (event: PhotoEvent) => boolean
  ): Promise<PhotoEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off(type, handler);
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeoutMs);

      const handler = (event: PhotoEvent) => {
        if (!filter || filter(event)) {
          clearTimeout(timeout);
          this.off(type, handler);
          resolve(event);
        }
      };

      this.on(type, handler);
    });
  }

  /**
   * Wait for photo processing to complete
   */
  async waitForProcessingComplete(
    photoId: string,
    timeoutMs: number = 60000
  ): Promise<PhotoEvent> {
    return this.waitForEvent(
      'photo.processing.completed',
      timeoutMs,
      (event) => event.photoId === photoId
    );
  }

  /**
   * Wait for any event for a specific photo
   */
  async waitForPhotoEvent(
    photoId: string,
    eventType: string,
    timeoutMs: number = 30000
  ): Promise<PhotoEvent> {
    return this.waitForEvent(
      eventType,
      timeoutMs,
      (event) => event.photoId === photoId
    );
  }
}

/**
 * Wait for a specific event in an events array
 */
export async function waitForEvent(
  events: PhotoEvent[],
  eventType: string,
  timeoutMs: number = 30000,
  filter?: (event: PhotoEvent) => boolean
): Promise<PhotoEvent> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const matchingEvent = events.find(
      (event) => event.type === eventType && (!filter || filter(event))
    );

    if (matchingEvent) {
      return matchingEvent;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timeout waiting for event: ${eventType}`);
}
