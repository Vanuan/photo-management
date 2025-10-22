export interface CacheConfig {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  maxSize: number; // Maximum number of cached items
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export class CacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private hitCount = 0;
  private missCount = 0;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private config: CacheConfig) {
    if (config.enabled) {
      // Schedule periodic cleanup every 5 minutes
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.config.enabled) {
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.hitCount++;

    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const timeToLive = (ttl || this.config.ttl) * 1000;
    const expiresAt = Date.now() + timeToLive;

    const entry: CacheEntry<T> = {
      data,
      expiresAt,
      accessCount: 1,
      lastAccessed: Date.now(),
    };

    // Check if we need to make room
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    if (this.config.enabled) {
      this.cache.delete(key);
    }
  }

  async deletePattern(pattern: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Convert simple glob pattern to regex
    const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    if (this.config.enabled) {
      this.cache.clear();
      this.hitCount = 0;
      this.missCount = 0;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getTTL(): number {
    return this.config.ttl;
  }

  getSize(): number {
    return this.cache.size;
  }

  getHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }

  getStats(): {
    size: number;
    maxSize: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
    enabled: boolean;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: this.getHitRate(),
      enabled: this.config.enabled,
    };
  }

  async ping(): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    try {
      // Simple health check by setting and getting a test value
      const testKey = '__cache_health_check__';
      const testValue = Date.now().toString();

      await this.set(testKey, testValue, 1); // 1 second TTL
      const retrieved = await this.get(testKey);
      await this.delete(testKey);

      return retrieved === testValue;
    } catch (error) {
      return false;
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.cache.clear();
  }

  private cleanup(): void {
    if (!this.config.enabled) {
      return;
    }

    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      console.log(`Cache cleanup: removed ${expiredCount} expired entries`);
    }
  }

  private evictOldest(): void {
    if (this.cache.size === 0) {
      return;
    }

    // Find the entry with the oldest lastAccessed time
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// Helper function to create cache manager with defaults
export function createCacheManager(config?: Partial<CacheConfig>): CacheManager {
  const defaultConfig: CacheConfig = {
    enabled: true,
    ttl: 300, // 5 minutes
    maxSize: 1000,
  };

  return new CacheManager({ ...defaultConfig, ...config });
}
