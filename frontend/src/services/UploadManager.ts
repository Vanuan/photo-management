import { v4 as uuidv4 } from "uuid";
import { opfsStorage } from "./OPFSStorage";
// WebSocketClient is now managed through context
// We'll get it from the WebSocketProvider when needed
// WebSocketClient is now managed through context
// We'll get it from the WebSocketProvider when needed
import type { WebSocketClient } from "./WebSocketClient";

// The 'export' keyword here is the fix for the error you're seeing.
export type UploadStatus =
  | "pending"
  | "cached"
  | "uploading"
  | "uploaded"
  | "failed"
  | "error"
  | "processing"
  | "completed";

export interface UploadTask {
  id: string;
  photoId: string;
  fileName: string;
  status: UploadStatus;
  timestamp: number;
  retries: number;
  lastAttempt?: number;
  error?: string;
  progress?: number;
  uploadedAt?: number;
  backendPhotoId?: string;
}

type OnQueueChangeCallback = (queue: UploadTask[]) => void;

const LS_QUEUE_KEY = "photo_capture_queue_v2";
const LS_USER_ID_KEY = "user_id";
const CONCURRENCY_LIMIT = 3;
const RETRY_MAX_ATTEMPTS = 5;
const PROCESS_INTERVAL_MS = 500;
const UPLOAD_API_URL = "/api/photos/upload";

class UploadManager {
  private static instance: UploadManager;
  private queue: UploadTask[] = [];
  private concurrencyLimit: number = CONCURRENCY_LIMIT;
  private runningUploadCount: number = 0;
  private onChangeCallbacks: OnQueueChangeCallback[] = [];
  private apiUrl: string = UPLOAD_API_URL;
  private userId: string;
  private webSocketClient: WebSocketClient | null = null;
  private processingLoopIntervalId: ReturnType<typeof setInterval> | null =
    null;

  private constructor() {
    this.userId = this.getUserId();
    this.loadQueue();
    this.startProcessing();

    window.addEventListener("online", this.handleNetworkChange);
    window.addEventListener("offline", this.handleNetworkChange);

    // WebSocket event handling will be set up through context
    // WebSocket event handling will be set up through context
    // webSocketClient.on("photo.uploaded", (data: unknown) =>
    //   this.handleWebSocketEvent(
    //     "photo.uploaded",
    //     data as Record<string, unknown>,
    //   ),
    // );
    // this.webSocketClient.on("photo.processing.started", (data: unknown) =>
    //   this.handleWebSocketEvent(
    //     "photo.processing.started",
    //     data as Record<string, unknown>,
    //   ),
    // );
    // this.webSocketClient.on("photo.processing.completed", (data: unknown) =>
    //   this.handleWebSocketEvent(
    //     "photo.processing.completed",
    //     data as Record<string, unknown>,
    //   ),
    // );
    // this.webSocketClient.on("photo.processing.failed", (data: unknown) =>
    //   this.handleWebSocketEvent(
    //     "photo.processing.failed",
    //     data as Record<string, unknown>,
    //   ),
    // );
    // webSocketClient.on("photo.processing.failed", (data: unknown) =>
    //   this.handleWebSocketEvent(
    //     "photo.processing.failed",
    //     data as Record<string, unknown>,
    //   ),
    // );
  }

  public static getInstance(): UploadManager {
    if (!UploadManager.instance) {
      UploadManager.instance = new UploadManager();
    }
    return UploadManager.instance;
  }

  private getUserId(): string {
    const userId = localStorage.getItem(LS_USER_ID_KEY);
    if (!userId) {
      const newUserId = uuidv4();
      localStorage.setItem(LS_USER_ID_KEY, newUserId);
      return newUserId;
    }
    return userId;
  }

  private loadQueue(): void {
    try {
      const storedQueue = localStorage.getItem(LS_QUEUE_KEY);
      if (storedQueue) {
        this.queue = JSON.parse(storedQueue);
      }
    } catch {
      this.queue = [];
    }
  }

  private saveQueue(): void {
    try {
      localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(this.queue));
      this.notifyChange();
    } catch (error) {
      console.error("Failed to save upload queue:", error);
    }
  }

  // Method to set up WebSocket event listeners
  public setupWebSocketListeners(webSocketClient: WebSocketClient) {
    this.webSocketClient = webSocketClient;

    webSocketClient.on("photo.uploaded", (data: unknown) =>
      this.handleWebSocketEvent(
        "photo.uploaded",
        data as Record<string, unknown>,
      ),
    );
    webSocketClient.on("photo.processing.started", (data: unknown) =>
      this.handleWebSocketEvent(
        "photo.processing.started",
        data as Record<string, unknown>,
      ),
    );
    webSocketClient.on("photo.processing.completed", (data: unknown) =>
      this.handleWebSocketEvent(
        "photo.processing.completed",
        data as Record<string, unknown>,
      ),
    );
    webSocketClient.on("photo.processing.failed", (data: unknown) =>
      this.handleWebSocketEvent(
        "photo.processing.failed",
        data as Record<string, unknown>,
      ),
    );
  }

  private notifyChange(): void {
    const queueCopy = [...this.queue];
    this.onChangeCallbacks.forEach((callback) => callback(queueCopy));
  }

  public subscribeToQueueChanges(callback: OnQueueChangeCallback): () => void {
    this.onChangeCallbacks.push(callback);
    callback([...this.queue]);
    return () => {
      this.onChangeCallbacks = this.onChangeCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  public getQueue(status?: UploadStatus): UploadTask[] {
    if (status) {
      return this.queue.filter((task) => task.status === status);
    }
    return [...this.queue];
  }

  public addToQueue(photoId: string, fileName: string): string {
    const newTask: UploadTask = {
      id: uuidv4(),
      photoId,
      fileName,
      status: "cached",
      timestamp: Date.now(),
      retries: 0,
      progress: 0,
    };
    this.queue.push(newTask);
    this.saveQueue();
    return newTask.id;
  }

  public updateItem(taskId: string, updates: Partial<UploadTask>): boolean {
    const taskIndex = this.queue.findIndex((task) => task.id === taskId);
    if (taskIndex !== -1) {
      this.queue[taskIndex] = { ...this.queue[taskIndex], ...updates };
      this.saveQueue();
      return true;
    }
    return false;
  }

  public retryUpload(taskId: string): boolean {
    const taskIndex = this.queue.findIndex((task) => task.id === taskId);
    if (taskIndex !== -1) {
      this.queue[taskIndex] = {
        ...this.queue[taskIndex],
        status: "cached",
        error: undefined,
        progress: 0,
        retries: 0,
        lastAttempt: undefined,
      };
      this.saveQueue();
      return true;
    }
    return false;
  }

  public removeItem(taskId: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter((task) => task.id !== taskId);
    if (this.queue.length < initialLength) {
      this.saveQueue();
      return true;
    }
    return false;
  }

  public startProcessing(): void {
    if (this.processingLoopIntervalId === null) {
      this.processingLoopIntervalId = setInterval(
        () => this.processNextInQueue(),
        PROCESS_INTERVAL_MS,
      );
    }
  }

  public stopProcessing(): void {
    if (this.processingLoopIntervalId !== null) {
      clearInterval(this.processingLoopIntervalId);
      this.processingLoopIntervalId = null;
    }
  }

  private handleNetworkChange = () => {
    if (navigator.onLine) {
      this.startProcessing();
    }
  };

  private async processNextInQueue(): Promise<void> {
    if (!navigator.onLine || this.runningUploadCount >= this.concurrencyLimit) {
      return;
    }

    const nextTask = this.queue.find(
      (task) =>
        (task.status === "cached" || task.status === "error") &&
        task.retries < RETRY_MAX_ATTEMPTS,
    );

    if (nextTask) {
      this.uploadItem(nextTask);
    }
  }

  private async uploadItem(item: UploadTask): Promise<void> {
    this.runningUploadCount++;
    this.updateItem(item.id, {
      status: "uploading",
      progress: 0,
      lastAttempt: Date.now(),
    });

    try {
      const blob = await opfsStorage.get(item.photoId, item.fileName);
      if (!blob) throw new Error("Blob not found in OPFS");

      const onProgress = (percent: number) =>
        this.updateItem(item.id, { progress: percent });
      const apiResponse = await this.uploadWithProgress(item, blob, onProgress);
      const backendPhotoId = apiResponse?.photoId;

      if (backendPhotoId) {
        this.updateItem(item.id, {
          status: "uploaded",
          progress: 100,
          uploadedAt: Date.now(),
          backendPhotoId: backendPhotoId,
        });
        this.webSocketClient?.subscribeToPhotoEvents(backendPhotoId);
        await opfsStorage.remove(item.photoId, item.fileName);
      } else {
        throw new Error("API response did not contain photoId.");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const newRetries = item.retries + 1;
      if (newRetries < RETRY_MAX_ATTEMPTS) {
        this.updateItem(item.id, {
          status: "error",
          retries: newRetries,
          error: errorMessage,
        });
      } else {
        this.updateItem(item.id, {
          status: "failed",
          error: `Max retries reached: ${errorMessage}`,
        });
      }
    } finally {
      this.runningUploadCount--;
    }
  }

  private uploadWithProgress(
    item: UploadTask,
    blob: Blob,
    onProgress: (percent: number) => void,
  ): Promise<{ photoId: string } | null> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.apiUrl, true);
      xhr.responseType = "json";
      xhr.setRequestHeader("X-User-ID", this.userId);
      xhr.timeout = 60000;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          reject(
            new Error(xhr.response?.message || `HTTP error: ${xhr.status}`),
          );
        }
      };
      xhr.onerror = () => reject(new Error("Network error."));
      xhr.ontimeout = () => reject(new Error("Request timed out."));

      const formData = new FormData();
      formData.append("photo", blob, item.fileName);
      xhr.send(formData);
    });
  }

  private handleWebSocketEvent(
    eventName: string,
    data: Record<string, unknown>,
  ): void {
    const { photoId, progress } = data;
    if (!photoId) return;

    const task = this.queue.find((t) => t.backendPhotoId === photoId);
    if (!task) return;

    let updates: Partial<UploadTask> = {};
    switch (eventName) {
      case "photo.processing.started":
        updates = { status: "processing", progress: 0 };
        break;
      case "photo.processing.stage.completed":
        updates = {
          status: "processing",
          progress: typeof progress === "number" ? progress : task.progress,
        };
        break;
      case "photo.processing.completed":
        updates = { status: "completed", progress: 100 };
        setTimeout(() => this.removeItem(task.id), 2000);
        break;
      case "photo.processing.failed":
        updates = {
          status: "failed",
          error: `Processing failed: ${data.error || "Unknown reason"}`,
        };
        break;
    }

    if (Object.keys(updates).length > 0) {
      this.updateItem(task.id, updates);
    }
  }

  public getStats() {
    return this.queue.reduce(
      (stats, task) => {
        stats.total++;
        // Type assertion to tell TypeScript that task.status is a valid key
        const status = task.status as keyof typeof stats;
        stats[status] = (stats[status] || 0) + 1;
        return stats;
      },
      {
        total: 0,
        cached: 0,
        uploading: 0,
        uploaded: 0,
        processing: 0,
        completed: 0,
        error: 0,
        failed: 0,
      },
    );
  }
}

export const uploadManager = UploadManager.getInstance();
