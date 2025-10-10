import { v4 as uuidv4 } from "uuid";

class OPFSStorage {
  private rootDirectory: FileSystemDirectoryHandle | null = null;
  private isInitialized = false;
  private inMemoryCache = new Map<string, Blob>(); // Fallback in-memory storage

  /**
   * Initializes the OPFSStorage service.
   * Attempts to get the root directory handle for the Origin Private File System.
   * If OPFS is not available or permission is denied, it will fall back to in-memory storage.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("OPFSStorage already initialized.");
      return;
    }

    try {
      if (
        "navigator" in window &&
        "storage" in navigator &&
        "getDirectory" in navigator.storage
      ) {
        this.rootDirectory = await navigator.storage.getDirectory();
        console.log("OPFSStorage initialized successfully.");
        this.isInitialized = true;
      } else {
        console.warn(
          "Origin Private File System API not available. Falling back to in-memory storage.",
        );
        this.isInitialized = true; // Still mark as initialized, just using fallback
      }
    } catch (error) {
      console.error(
        "Failed to initialize OPFSStorage, falling back to in-memory:",
        error,
      );
      this.rootDirectory = null; // Ensure it's null if an error occurs
      this.isInitialized = true; // Still mark as initialized
    }
  }

  /**
   * Puts a file (Blob) into storage.
   * Uses OPFS if available, otherwise falls back to in-memory Map.
   * @param blob The Blob to store.
   * @param fileName Optional file name. A UUID will be generated if not provided.
   * @returns The ID of the stored file.
   */
  async put(blob: Blob, fileName?: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize(); // Auto-initialize if not already
    }

    const id = uuidv4();
    const name = fileName || `${id}.${blob.type.split("/")[1] || "bin"}`; // e.g., image/jpeg -> jpeg

    if (this.rootDirectory) {
      try {
        const fileHandle = await this.rootDirectory.getFileHandle(name, {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        console.log(`File ${name} (ID: ${id}) stored in OPFS.`);
        // Optionally store metadata in IndexedDB or another service for quick lookup
        return id;
      } catch (error) {
        console.error(
          `Failed to store file ${name} in OPFS, using in-memory fallback:`,
          error,
        );
        this.inMemoryCache.set(id, blob);
        return id;
      }
    } else {
      // Fallback to in-memory storage
      this.inMemoryCache.set(id, blob);
      console.log(`File ${name} (ID: ${id}) stored in in-memory cache.`);
      return id;
    }
  }

  /**
   * Retrieves a file (Blob) by its ID.
   * @param id The ID of the file to retrieve.
   * @param fileName The name of the file (required for OPFS retrieval).
   * @returns The Blob, or null if not found.
   */
  async get(id: string, fileName: string): Promise<Blob | null> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.rootDirectory) {
      try {
        const fileHandle = await this.rootDirectory.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        console.log(`File ${fileName} (ID: ${id}) retrieved from OPFS.`);
        return file;
      } catch (error: any) {
        if (error.name === "NotFoundError") {
          console.warn(
            `File ${fileName} (ID: ${id}) not found in OPFS, checking in-memory.`,
          );
        } else {
          console.error(
            `Failed to retrieve file ${fileName} from OPFS, checking in-memory:`,
            error,
          );
        }
        return this.inMemoryCache.get(id) || null;
      }
    } else {
      return this.inMemoryCache.get(id) || null;
    }
  }

  /**
   * Removes a file by its ID.
   * @param id The ID of the file to remove.
   * @param fileName The name of the file (required for OPFS removal).
   * @returns True if successful, false otherwise.
   */
  async remove(id: string, fileName: string): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.rootDirectory) {
      try {
        await this.rootDirectory.removeEntry(fileName);
        console.log(`File ${fileName} (ID: ${id}) removed from OPFS.`);
        this.inMemoryCache.delete(id); // Also remove from cache if it was there
        return true;
      } catch (error: any) {
        if (error.name === "NotFoundError") {
          console.warn(
            `File ${fileName} (ID: ${id}) not found in OPFS for removal, checking in-memory.`,
          );
        } else {
          console.error(
            `Failed to remove file ${fileName} from OPFS, attempting in-memory:`,
            error,
          );
        }
        return this.inMemoryCache.delete(id);
      }
    } else {
      return this.inMemoryCache.delete(id);
    }
  }

  /**
   * Gets the estimated and used storage usage.
   * Returns { usage: number, quota: number } in bytes.
   * Note: This might not be accurate for in-memory fallback.
   */
  async getUsage(): Promise<{ usage: number; quota: number }> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
      } catch (error) {
        console.error("Failed to get storage estimate:", error);
      }
    }
    // Fallback for in-memory or if estimate API fails
    let usage = 0;
    this.inMemoryCache.forEach((blob) => {
      usage += blob.size;
    });
    return { usage: usage, quota: -1 }; // -1 indicates unknown quota
  }
}

export const opfsStorage = new OPFSStorage();
