import { io, Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid"; // For generating session ID

type EventCallback = (...args: any[]) => void;

const LS_USER_ID_KEY = "user_id"; // Consistent with UploadManager

class WebSocketClient {
  private socket: Socket | null = null;
  private url: string;
  private isConnected: boolean = false;
  private userId: string;
  private sessionId: string; // New: Session ID for client identification
  private eventHandlers = new Map<string, EventCallback[]>();

  constructor(url: string) {
    this.url = url;
    this.userId = this.getUserId();
    this.sessionId = uuidv4(); // Generate a new session ID for each instance/connection cycle
  }

  /**
   * Retrieves or generates a unique user ID and stores it in localStorage.
   * Consistent with UploadManager.
   * @returns The user ID.
   */
  private getUserId(): string {
    let userId = localStorage.getItem(LS_USER_ID_KEY);
    if (!userId) {
      userId = uuidv4();
      localStorage.setItem(LS_USER_ID_KEY, userId);
    }
    return userId;
  }

  /**
   * Connects to the WebSocket server.
   * Handles initial connection and reconnection logic using socket.io-client's built-in features.
   */
  public connect(): void {
    if (this.socket && this.socket.connected) {
      console.warn("WebSocket client is already connected.");
      return;
    }

    console.log(`Attempting to connect to WebSocket: ${this.url}`);
    this.socket = io(this.url, {
      transports: ["websocket", "polling"], // Prioritize WebSocket, fallback to polling
      reconnection: true,
      reconnectionDelay: 1000, // Initial delay before first reconnect attempt
      reconnectionAttempts: 5, // Max number of reconnect attempts
      // Send userId and sessionId with authentication payload
      auth: {
        userId: this.userId,
        sessionId: this.sessionId,
      },
      autoConnect: false, // We'll manage connection manually
    });

    this.socket.on("connect", () => {
      console.log("WebSocket connected:", this.socket?.id);
      this.isConnected = true;
      this.emitLocalEvent("connected", {
        userId: this.userId,
        sessionId: this.sessionId,
        socketId: this.socket?.id,
      });

      // Emit an 'identify' event to the server upon connection
      this.socket?.emit("identify", {
        userId: this.userId,
        sessionId: this.sessionId,
      });
    });

    this.socket.on("disconnect", (reason: Socket.DisconnectReason) => {
      console.warn("WebSocket disconnected:", reason);
      this.isConnected = false;
      this.emitLocalEvent("disconnected", reason);
    });

    this.socket.on("connect_error", (error: Error) => {
      console.error("WebSocket connection error:", error.message);
      this.emitLocalEvent("connection_error", error);
    });

    // Custom event to confirm server-side identification and room joining
    this.socket.on(
      "identified",
      (data: {
        userId: string;
        sessionId: string;
        clientRoomJoined: boolean;
        sessionRoomJoined: boolean;
      }) => {
        console.log("Client identified by server and rooms joined:", data);
        this.emitLocalEvent("identified", data);
      },
    );

    // Listen for all incoming events from the server and propagate them
    this.socket.onAny((eventName: string, ...args: any[]) => {
      this.onSocketEvent(eventName, ...args);
    });

    this.socket.connect(); // Manually initiate connection
  }

  /**
   * Disconnects from the WebSocket server.
   */
  public disconnect(): void {
    if (this.socket && this.socket.connected) {
      console.log("Disconnecting WebSocket client.");
      this.socket.disconnect();
    } else {
      console.warn("WebSocket client is not connected.");
    }
    this.isConnected = false;
  }

  /**
   * Sends an event with data to the WebSocket server.
   * @param eventName The name of the event to emit.
   * @param data The data to send with the event.
   */
  public emit(eventName: string, data: any): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit(eventName, data);
    } else {
      console.warn(
        `Cannot emit event "${eventName}", WebSocket not connected. Data:`,
        data,
      );
    }
  }

  /**
   * Subscribes to photo-specific events by joining a room on the server.
   * This sends a signal to the server to add this client's socket to the photo:${photoId} room.
   * @param photoId The ID of the photo to subscribe to.
   */
  public subscribeToPhotoEvents(photoId: string): void {
    if (this.socket && this.socket.connected) {
      console.log(`Subscribing to events for photoId: ${photoId}`);
      this.socket.emit("subscribe:photo", {
        photoId,
        userId: this.userId,
        sessionId: this.sessionId,
      });
    } else {
      console.warn(
        `Cannot subscribe to photo events for ${photoId}, WebSocket not connected.`,
      );
    }
  }

  /**
   * Listens for an event, either internal ('connected', 'disconnected', 'connection_error', 'identified')
   * or a generic event from the server.
   * @param eventName The name of the event to listen for.
   * @param callback The callback function to execute when the event is received.
   * @returns A function to unsubscribe the callback.
   */
  public on(eventName: string, callback: EventCallback): () => void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName)?.push(callback);
    return () => this.off(eventName, callback); // Return unsubscribe function
  }

  /**
   * Unsubscribes from an event.
   * @param eventName The name of the event to unsubscribe from.
   * @param callback The specific callback function to remove.
   */
  public off(eventName: string, callback: EventCallback): void {
    if (this.eventHandlers.has(eventName)) {
      const handlers = this.eventHandlers.get(eventName);
      if (handlers) {
        this.eventHandlers.set(
          eventName,
          handlers.filter((cb) => cb !== callback),
        );
      }
    }
  }

  /**
   * Processes incoming events from the WebSocket server and emits them locally.
   * This method acts as a central dispatcher for all server-sent events.
   * @param eventName The name of the event received from the server.
   * @param args Arguments received with the event.
   */
  private onSocketEvent(eventName: string, ...args: any[]): void {
    console.log(`WebSocket event received: ${eventName}`, ...args);
    // Propagate all server events locally
    this.emitLocalEvent(eventName, ...args);
  }

  /**
   * Emits an internal event to local subscribers.
   * Used for 'connected', 'disconnected', 'connection_error', 'identified' and all server-sent events.
   * @param eventName The name of the local event.
   * @param args Arguments to pass to the event handlers.
   */
  private emitLocalEvent(eventName: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(...args);
        } catch (e) {
          console.error(
            `Error in WebSocket event handler for ${eventName}:`,
            e,
          );
        }
      });
    }
  }

  /**
   * Returns the current connection status.
   */
  public getStatus(): boolean {
    return this.isConnected;
  }
}

// Export a singleton instance.
// Ensure VITE_WEBSOCKET_URL is defined in .env or provide a default fallback.
export const webSocketClient = new WebSocketClient(
  import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:3000",
);
