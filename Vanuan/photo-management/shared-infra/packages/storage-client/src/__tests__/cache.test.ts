import { CacheManager, createCacheManager, CacheConfig } from '../cache';

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let config: CacheConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      ttl: 300,
      maxSize: 10,
    };
    cacheManager = new CacheManager(config);
  });

  afterEach(() => {
    cacheManager.shutdown();
  });

  describe('constructor', () => {
    it('should initialize with given configuration', () => {
      expect(cacheManager.isEnabled()).toBe(true);
      expect(cacheManager.getTTL()).toBe(300);
      expect(cacheManager.getSize()).toBe(0);
    });

    it('should not start cleanup interval when disabled', () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledCache = new CacheManager(disabledConfig);

      expect(disabledCache.isEnabled()).toBe(false);
      disabledCache.shutdown();
    });
  });

  describe('get/set operations', () => {
    it('should set and get values successfully', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };

      await cacheManager.set(key, value);
      const result = await cacheManager.get(key);

      expect(result).toEqual(value);
      expect(cacheManager.getSize()).toBe(1);
    });

    it('should return null for non-existent keys', async () => {
      const result = await cacheManager.get('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when cache is disabled', async () => {
      const disabledConfig = { ...config, enabled: false };
      const disabledCache = new CacheManager(disabledConfig);

      await disabledCache.set('key', 'value');
      const result = await disabledCache.get('key');

      expect(result).toBeNull();
      expect(disabledCache.getSize()).toBe(0);

      disabledCache.shutdown();
    });

    it('should use custom TTL when provided', async () => {
      const key = 'test-key';
      const value = 'test-value';
      const customTTL = 1; // 1 second

      await cacheManager.set(key, value, customTTL);

      // Should be available immediately
      let result = await cacheManager.get(key);
      expect(result).toBe(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired
      result = await cacheManager.get(key);
      expect(result).toBeNull();
    });

    it('should handle different data types', async () => {
      const stringValue = 'string-value';
      const numberValue = 42;
      const objectValue = { key: 'value', nested: { data: 123 } };
      const arrayValue = [1, 2, 3, 'test'];

      await cacheManager.set('string', stringValue);
      await cacheManager.set('number', numberValue);
      await cacheManager.set('object', objectValue);
      await cacheManager.set('array', arrayValue);

      expect(await cacheManager.get('string')).toBe(stringValue);
      expect(await cacheManager.get('number')).toBe(numberValue);
      expect(await cacheManager.get('object')).toEqual(objectValue);
      expect(await cacheManager.get('array')).toEqual(arrayValue);
    });
  });

  describe('expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTTLConfig = { ...config, ttl: 1 }; // 1 second
      const shortTTLCache = new CacheManager(shortTTLConfig);

      await shortTTLCache.set('key', 'value');

      // Should be available immediately
      let result = await shortTTLCache.get('key');
      expect(result).toBe('value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be expired and deleted
      result = await shortTTLCache.get('key');
      expect(result).toBeNull();
      expect(shortTTLCache.getSize()).toBe(0);

      shortTTLCache.shutdown();
    });

    it('should update last accessed time on get', async () => {
      await cacheManager.set('key', 'value', 3); // 3 seconds TTL

      // Access after 1 second - should still be available
      await new Promise(resolve => setTimeout(resolve, 1000));
      let result = await cacheManager.get('key');
      expect(result).toBe('value');

      // Access after another second (total 2 seconds) - should still be available
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await cacheManager.get('key');
      expect(result).toBe('value');

      // Wait for final second (total 3+ seconds) - should be expired
      await new Promise(resolve => setTimeout(resolve, 1100));
      result = await cacheManager.get('key');
      expect(result).toBeNull(); // Should be expired
    });
  });

  describe('eviction policy', () => {
    beforeEach(() => {
      // Shutdown previous instance before creating new one
      if (cacheManager) {
        cacheManager.shutdown();
      }
      // Use small cache for testing eviction
      config.maxSize = 3;
      cacheManager = new CacheManager(config);
    });

    it('should evict oldest entry when cache is full', async () => {
      // Fill cache to capacity
      await cacheManager.set('key1', 'value1');
      await new Promise(resolve => setTimeout(resolve, 10));
      await cacheManager.set('key2', 'value2');
      await new Promise(resolve => setTimeout(resolve, 10));
      await cacheManager.set('key3', 'value3');

      expect(cacheManager.getSize()).toBe(3);

      // Access key2 to make it more recently used
      await cacheManager.get('key2');

      // Add one more item, should evict key1 (oldest accessed)
      await cacheManager.set('key4', 'value4');

      expect(cacheManager.getSize()).toBe(3);
      expect(await cacheManager.get('key1')).toBeNull(); // Should be evicted
      expect(await cacheManager.get('key2')).toBe('value2'); // Should still exist
      expect(await cacheManager.get('key3')).toBe('value3'); // Should still exist
      expect(await cacheManager.get('key4')).toBe('value4'); // Should exist
    });

    it('should not evict when cache is not at capacity', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');

      expect(cacheManager.getSize()).toBe(2);
      expect(await cacheManager.get('key1')).toBe('value1');
      expect(await cacheManager.get('key2')).toBe('value2');
    });
  });

  describe('delete operations', () => {
    it('should delete specific key', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');

      expect(cacheManager.getSize()).toBe(2);

      await cacheManager.delete('key1');

      expect(cacheManager.getSize()).toBe(1);
      expect(await cacheManager.get('key1')).toBeNull();
      expect(await cacheManager.get('key2')).toBe('value2');
    });

    it('should handle deleting non-existent key', async () => {
      await cacheManager.delete('non-existent');
      expect(cacheManager.getSize()).toBe(0);
    });

    it('should delete keys matching pattern', async () => {
      await cacheManager.set('user:123', 'user123');
      await cacheManager.set('user:456', 'user456');
      await cacheManager.set('photo:123', 'photo123');
      await cacheManager.set('settings:config', 'config');

      expect(cacheManager.getSize()).toBe(4);

      await cacheManager.deletePattern('user:*');

      expect(cacheManager.getSize()).toBe(2);
      expect(await cacheManager.get('user:123')).toBeNull();
      expect(await cacheManager.get('user:456')).toBeNull();
      expect(await cacheManager.get('photo:123')).toBe('photo123');
      expect(await cacheManager.get('settings:config')).toBe('config');
    });

    it('should handle complex patterns', async () => {
      await cacheManager.set('a.b.c', 'value1');
      await cacheManager.set('a.b.d', 'value2');
      await cacheManager.set('a.x.c', 'value3');
      await cacheManager.set('b.b.c', 'value4');

      await cacheManager.deletePattern('a.?.c');

      expect(await cacheManager.get('a.b.c')).toBeNull();
      expect(await cacheManager.get('a.x.c')).toBeNull();
      expect(await cacheManager.get('a.b.d')).toBe('value2');
      expect(await cacheManager.get('b.b.c')).toBe('value4');
    });

    it('should clear all entries', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');
      await cacheManager.set('key3', 'value3');

      expect(cacheManager.getSize()).toBe(3);

      await cacheManager.clear();

      expect(cacheManager.getSize()).toBe(0);
      expect(cacheManager.getStats().hitCount).toBe(0);
      expect(cacheManager.getStats().missCount).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track hit and miss counts', async () => {
      await cacheManager.set('key', 'value');

      // Cache hit
      await cacheManager.get('key');
      // Cache miss
      await cacheManager.get('non-existent');
      // Another cache hit
      await cacheManager.get('key');

      const stats = cacheManager.getStats();
      expect(stats.hitCount).toBe(2);
      expect(stats.missCount).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it('should calculate hit rate correctly', async () => {
      expect(cacheManager.getHitRate()).toBe(0); // No operations yet

      await cacheManager.set('key', 'value');
      await cacheManager.get('key'); // Hit
      await cacheManager.get('missing'); // Miss

      expect(cacheManager.getHitRate()).toBe(0.5);
    });

    it('should return comprehensive stats', async () => {
      await cacheManager.set('key1', 'value1');
      await cacheManager.set('key2', 'value2');
      await cacheManager.get('key1'); // Hit
      await cacheManager.get('missing'); // Miss

      const stats = cacheManager.getStats();
      expect(stats).toEqual({
        size: 2,
        maxSize: 10,
        hitCount: 1,
        missCount: 1,
        hitRate: 0.5,
        enabled: true,
      });
    });
  });

  describe('health check', () => {
    it('should pass health check when working', async () => {
      const result = await cacheManager.ping();
      expect(result).toBe(true);
    });

    it('should return true for disabled cache', async () => {
      const disabledCache = new CacheManager({ ...config, enabled: false });
      const result = await disabledCache.ping();
      expect(result).toBe(true);
      disabledCache.shutdown();
    });

    it('should handle health check failure gracefully', async () => {
      // Mock the set method to throw an error
      const originalSet = cacheManager.set;
      cacheManager.set = jest.fn().mockRejectedValue(new Error('Cache error'));

      const result = await cacheManager.ping();
      expect(result).toBe(false);

      // Restore original method
      cacheManager.set = originalSet;
    });
  });

  describe('cleanup', () => {
    it('should automatically clean up expired entries', async () => {
      const shortTTLConfig = { ...config, ttl: 1 }; // 1 second
      const shortTTLCache = new CacheManager(shortTTLConfig);

      await shortTTLCache.set('key1', 'value1');
      await shortTTLCache.set('key2', 'value2');

      expect(shortTTLCache.getSize()).toBe(2);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Trigger cleanup by trying to access expired items
      await shortTTLCache.get('key1');
      await shortTTLCache.get('key2');

      expect(shortTTLCache.getSize()).toBe(0);

      shortTTLCache.shutdown();
    });

    it('should shutdown cleanup interval', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      cacheManager.shutdown();

      // Should not throw error when called again
      expect(() => cacheManager.shutdown()).not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('disabled cache behavior', () => {
    let disabledCache: CacheManager;

    beforeEach(() => {
      disabledCache = new CacheManager({ ...config, enabled: false });
    });

    afterEach(() => {
      disabledCache.shutdown();
    });

    it('should not store or retrieve values when disabled', async () => {
      await disabledCache.set('key', 'value');
      const result = await disabledCache.get('key');

      expect(result).toBeNull();
      expect(disabledCache.getSize()).toBe(0);
    });

    it('should handle all operations gracefully when disabled', async () => {
      await disabledCache.set('key', 'value');
      await disabledCache.delete('key');
      await disabledCache.deletePattern('*');
      await disabledCache.clear();

      expect(disabledCache.getSize()).toBe(0);
      expect(disabledCache.isEnabled()).toBe(false);
    });
  });
});

describe('createCacheManager', () => {
  it('should create cache manager with default config', () => {
    const cache = createCacheManager();

    expect(cache.isEnabled()).toBe(true);
    expect(cache.getTTL()).toBe(300);

    const stats = cache.getStats();
    expect(stats.maxSize).toBe(1000);

    cache.shutdown();
  });

  it('should create cache manager with custom config', () => {
    const cache = createCacheManager({
      enabled: false,
      ttl: 600,
      maxSize: 500,
    });

    expect(cache.isEnabled()).toBe(false);
    expect(cache.getTTL()).toBe(600);

    const stats = cache.getStats();
    expect(stats.maxSize).toBe(500);

    cache.shutdown();
  });

  it('should merge partial config with defaults', () => {
    const cache = createCacheManager({ ttl: 600 });

    expect(cache.isEnabled()).toBe(true); // default
    expect(cache.getTTL()).toBe(600); // custom

    const stats = cache.getStats();
    expect(stats.maxSize).toBe(1000); // default

    cache.shutdown();
  });
});
