# SQLite Storage Layer Documentation

## Overview

SQLite serves as the metadata database for the Storage Layer, maintaining structured data about photos, processing status, and relationships while providing full-text search capabilities and transactional integrity.

## Table of Contents

- [Database Schema](#database-schema)
- [Core Operations](#core-operations)
- [Performance Optimizations](#performance-optimizations)
- [Search Capabilities](#search-capabilities)
- [Consistency & Integrity](#consistency--integrity)
- [Backup & Recovery](#backup--recovery)
- [Implementation Details](#implementation-details)

---

## Database Schema

### Primary Tables

#### Photos Table
```sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  s3_key TEXT NOT NULL UNIQUE,
  s3_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  
  -- Content metadata
  width INTEGER,
  height INTEGER,
  duration INTEGER, -- for videos
  checksum TEXT,
  
  -- Client context
  client_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  
  -- Processing information
  processing_status TEXT NOT NULL DEFAULT 'queued' 
    CHECK (processing_status IN ('queued', 'in_progress', 'completed', 'failed', 'cancelled')),
  processing_metadata TEXT, -- JSON blob
  processing_error TEXT,
  
  -- Timestamps
  uploaded_at TEXT NOT NULL,
  processing_started_at TEXT,
  processing_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Thumbnails Table (Future Extension)
```sql
CREATE TABLE IF NOT EXISTS thumbnails (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  s3_key TEXT NOT NULL UNIQUE,
  s3_url TEXT NOT NULL,
  bucket TEXT NOT NULL,
  size_name TEXT NOT NULL, -- 'small', 'medium', 'large'
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
```

### Performance Indexes

```sql
-- Primary lookups
CREATE INDEX IF NOT EXISTS idx_photos_client_id ON photos(client_id);
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_processing_status ON photos(processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_photos_bucket_key ON photos(bucket, s3_key);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_photos_client_status ON photos(client_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_user_uploaded ON photos(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_mime_uploaded ON photos(mime_type, uploaded_at DESC);

-- Thumbnails indexes
CREATE INDEX IF NOT EXISTS idx_thumbnails_photo_id ON thumbnails(photo_id);
CREATE INDEX IF NOT EXISTS idx_thumbnails_size ON thumbnails(size_name);
```

### Full-Text Search

```sql
-- Virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS photos_search USING fts5(
  photo_id UNINDEXED,
  filename,
  mime_type,
  content='photos',
  content_rowid='rowid'
);

-- Triggers to maintain search index
CREATE TRIGGER IF NOT EXISTS photos_search_insert 
  AFTER INSERT ON photos 
BEGIN
  INSERT INTO photos_search(photo_id, filename, mime_type)
  VALUES (NEW.id, NEW.original_filename, NEW.mime_type);
END;

CREATE TRIGGER IF NOT EXISTS photos_search_update 
  AFTER UPDATE ON photos 
BEGIN
  INSERT INTO photos_search(photos_search, photo_id, filename, mime_type)
  VALUES ('delete', OLD.id, OLD.original_filename, OLD.mime_type);
  INSERT INTO photos_search(photo_id, filename, mime_type)
  VALUES (NEW.id, NEW.original_filename, NEW.mime_type);
END;

CREATE TRIGGER IF NOT EXISTS photos_search_delete 
  AFTER DELETE ON photos 
BEGIN
  INSERT INTO photos_search(photos_search, photo_id, filename, mime_type)
  VALUES ('delete', OLD.id, OLD.original_filename, OLD.mime_type);
END;
```

### Audit & Timestamp Triggers

```sql
-- Automatic timestamp updates
CREATE TRIGGER IF NOT EXISTS update_photos_timestamp 
  AFTER UPDATE ON photos
BEGIN
  UPDATE photos SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Audit trail (optional)
CREATE TABLE IF NOT EXISTS photo_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  changed_by TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Core Operations

### Photo Storage Operations

#### Insert New Photo
```typescript
async insert(table: string, data: Record<string, any>): Promise<void> {
  const columns = Object.keys(data).join(', ');
  const placeholders = Object.keys(data).map(() => '?').join(', ');
  const values = Object.values(data);
  
  const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
  await this.run(sql, values);
}

// Usage example:
const photoRecord = {
  id: photoId,
  s3_key: s3Key,
  s3_url: s3Url,
  bucket,
  file_size: data.length,
  mime_type: options.contentType || 'application/octet-stream',
  original_filename: options.originalName,
  checksum,
  client_id: options.clientId,
  session_id: options.sessionId,
  user_id: options.userId,
  processing_status: 'queued',
  uploaded_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

await this.sqliteClient.insert('photos', photoRecord);
```

#### Retrieve Photo
```typescript
async getPhoto(photoId: string): Promise<Photo | null> {
  return this.sqliteClient.get<Photo>(
    'SELECT * FROM photos WHERE id = ?',
    [photoId]
  );
}
```

#### Update Photo Metadata
```typescript
async updatePhotoMetadata(photoId: string, metadata: Partial<PhotoMetadata>): Promise<void> {
  const updates = Object.keys(metadata).map(key => `${key} = ?`).join(', ');
  const values = Object.values(metadata);
  
  await this.sqliteClient.run(
    `UPDATE photos SET ${updates}, updated_at = ? WHERE id = ?`,
    [...values, new Date().toISOString(), photoId]
  );
}
```

#### Delete Photo
```typescript
async deletePhoto(photoId: string): Promise<void> {
  await this.sqliteClient.run('DELETE FROM photos WHERE id = ?', [photoId]);
  // Cascading delete will handle thumbnails via FOREIGN KEY constraint
}
```

### Search Operations

#### Full-Text Search
```typescript
async searchPhotos(query: SearchQuery): Promise<SearchResult> {
  const { sql, params } = this.buildSearchQuery(query);
  const photos = await this.sqliteClient.all<Photo>(sql, params);
  
  // Get total count for pagination
  const countSql = sql.replace(/SELECT \*/g, 'SELECT COUNT(*)').replace(/ORDER BY .*/g, '');
  const countResult = await this.sqliteClient.get<{ 'COUNT(*)': number }>(countSql, params);
  
  return {
    photos,
    total: countResult?.['COUNT(*)'] || 0,
    page: {
      limit: query.limit || 50,
      offset: query.offset || 0,
      hasMore: photos.length === (query.limit || 50)
    },
    searchTime: 0
  };
}

private buildSearchQuery(query: SearchQuery): { sql: string; params: any[] } {
  let sql = 'SELECT * FROM photos WHERE 1=1';
  const params: any[] = [];
  
  // Full-text search
  if (query.query) {
    sql += ` AND id IN (
      SELECT photo_id FROM photos_search 
      WHERE photos_search MATCH ?
    )`;
    params.push(query.query);
  }
  
  // Filters
  if (query.filters?.client_id) {
    sql += ' AND client_id = ?';
    params.push(query.filters.client_id);
  }
  
  if (query.filters?.user_id) {
    sql += ' AND user_id = ?';
    params.push(query.filters.user_id);
  }
  
  if (query.filters?.mime_type) {
    sql += ` AND mime_type IN (${query.filters.mime_type.map(() => '?').join(',')})`;
    params.push(...query.filters.mime_type);
  }
  
  if (query.filters?.date_range) {
    sql += ' AND uploaded_at BETWEEN ? AND ?';
    params.push(query.filters.date_range.start, query.filters.date_range.end);
  }
  
  // Sorting
  if (query.sort) {
    sql += ` ORDER BY ${query.sort.field} ${query.sort.order.toUpperCase()}`;
  } else {
    sql += ' ORDER BY uploaded_at DESC';
  }
  
  // Pagination
  if (query.limit) {
    sql += ' LIMIT ?';
    params.push(query.limit);
    
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }
  }
  
  return { sql, params };
}
```

#### User Photo Queries
```typescript
async getUserPhotos(userId: string, options: PaginationOptions): Promise<PhotoPage> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;
  
  const photos = await this.sqliteClient.all<Photo>(
    'SELECT * FROM photos WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
    [userId, limit, offset]
  );
  
  const countResult = await this.sqliteClient.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM photos WHERE user_id = ?',
    [userId]
  );
  
  return {
    photos,
    pagination: {
      total: countResult?.count || 0,
      limit,
      offset,
      hasMore: photos.length === limit
    }
  };
}
```

### Batch Operations

#### Batch Insert
```typescript
async insertPhotoBatch(photos: PhotoRecord[]): Promise<void> {
  const stmt = this.db.prepare(`
    INSERT INTO photos (
      id, s3_key, s3_url, bucket, file_size, mime_type, original_filename,
      checksum, client_id, session_id, user_id, processing_status,
      uploaded_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = this.db.transaction((photos: PhotoRecord[]) => {
    for (const photo of photos) {
      stmt.run(
        photo.id, photo.s3_key, photo.s3_url, photo.bucket,
        photo.file_size, photo.mime_type, photo.original_filename,
        photo.checksum, photo.client_id, photo.session_id,
        photo.user_id, photo.processing_status, photo.uploaded_at,
        photo.created_at, photo.updated_at
      );
    }
  });
  
  insertMany(photos);
}
```

---

## Performance Optimizations

### SQLite Configuration

```typescript
async initialize(): Promise<void> {
  const Database = require('better-sqlite3');
  this.db = new Database(this.dbPath);
  
  // WAL mode for better concurrency
  this.db.pragma('journal_mode = WAL');
  
  // Balanced durability vs performance
  this.db.pragma('synchronous = NORMAL');
  
  // Large cache for better read performance
  this.db.pragma('cache_size = 10000');
  
  // Use memory for temp operations
  this.db.pragma('temp_store = memory');
  
  // Enable foreign key constraints
  this.db.pragma('foreign_keys = ON');
  
  // Optimize for read-heavy workloads
  this.db.pragma('mmap_size = 268435456'); // 256MB
  
  await this.runMigrations();
}
```

### Query Optimization

```typescript
// Prepared statements for common queries
class SQLiteClient {
  private preparedStatements: Map<string, any> = new Map();
  
  private getPreparedStatement(sql: string): any {
    if (!this.preparedStatements.has(sql)) {
      this.preparedStatements.set(sql, this.db.prepare(sql));
    }
    return this.preparedStatements.get(sql);
  }
  
  async get<T>(sql: string, params: any[] = []): Promise<T | null> {
    try {
      const stmt = this.getPreparedStatement(sql);
      return stmt.get(...params) || null;
    } catch (error) {
      this.logger.error('SQLite get error', { sql, error: error.message });
      throw error;
    }
  }
}
```

### Connection Management

```typescript
// Connection pooling (for multi-threaded scenarios)
class SQLiteConnectionPool {
  private pool: any[] = [];
  private readonly maxConnections = 5;
  
  async getConnection(): Promise<any> {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    
    if (this.activeConnections < this.maxConnections) {
      return this.createConnection();
    }
    
    // Wait for connection to be available
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }
  
  async releaseConnection(connection: any): Promise<void> {
    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      resolve(connection);
      return;
    }
    
    this.pool.push(connection);
  }
}
```

---

## Search Capabilities

### FTS5 Full-Text Search

The SQLite FTS5 (Full-Text Search) extension provides powerful text search capabilities:

```sql
-- Basic text search
SELECT photo_id FROM photos_search WHERE photos_search MATCH 'vacation';

-- Phrase search
SELECT photo_id FROM photos_search WHERE photos_search MATCH '"summer vacation"';

-- Boolean search
SELECT photo_id FROM photos_search WHERE photos_search MATCH 'vacation AND beach';

-- Field-specific search
SELECT photo_id FROM photos_search WHERE photos_search MATCH 'filename:IMG_*';

-- Proximity search
SELECT photo_id FROM photos_search WHERE photos_search MATCH 'vacation NEAR beach';
```

### Advanced Search Patterns

```typescript
class SearchQueryBuilder {
  static buildFTSQuery(searchTerms: string[]): string {
    // Handle different search patterns
    return searchTerms.map(term => {
      if (term.startsWith('"') && term.endsWith('"')) {
        // Phrase search
        return term;
      } else if (term.includes('*')) {
        // Wildcard search
        return term;
      } else {
        // Regular term
        return `"${term}"*`; // Prefix matching
      }
    }).join(' AND ');
  }
  
  static buildComplexQuery(query: SearchQuery): { sql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];
    
    // Base query with FTS
    let sql = `
      SELECT p.* FROM photos p
      ${query.query ? 'INNER JOIN photos_search ps ON p.id = ps.photo_id' : ''}
      WHERE 1=1
    `;
    
    if (query.query) {
      const ftsQuery = this.buildFTSQuery(query.query.split(' '));
      sql += ' AND ps.photos_search MATCH ?';
      params.push(ftsQuery);
    }
    
    // Additional filters...
    
    return { sql, params };
  }
}
```

---

## Consistency & Integrity

### Data Integrity Constraints

```sql
-- Ensure valid processing status
ALTER TABLE photos ADD CONSTRAINT chk_processing_status 
CHECK (processing_status IN ('queued', 'in_progress', 'completed', 'failed', 'cancelled'));

-- Ensure positive file sizes
ALTER TABLE photos ADD CONSTRAINT chk_file_size 
CHECK (file_size > 0);

-- Ensure valid timestamps
ALTER TABLE photos ADD CONSTRAINT chk_timestamps
CHECK (
  datetime(created_at) IS NOT NULL AND 
  datetime(updated_at) IS NOT NULL AND
  datetime(uploaded_at) IS NOT NULL
);
```

### Referential Integrity

```sql
-- Ensure thumbnails reference valid photos
ALTER TABLE thumbnails ADD CONSTRAINT fk_thumbnails_photo
FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;

-- Create index for foreign key performance
CREATE INDEX idx_thumbnails_photo_fk ON thumbnails(photo_id);
```

### Transaction Management

```typescript
class TransactionManager {
  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const transaction = this.db.transaction((op: () => T) => {
      return op();
    });
    
    try {
      return transaction(operation);
    } catch (error) {
      this.logger.error('Transaction failed', { error: error.message });
      throw error;
    }
  }
  
  // Usage
  async storePhotoWithMetadata(photoData: any, metadata: any): Promise<void> {
    await this.withTransaction(async () => {
      await this.insertPhoto(photoData);
      await this.insertMetadata(metadata);
      await this.updateSearchIndex(photoData.id);
    });
  }
}
```

---

## Backup & Recovery

### Automated Backups

```typescript
class SQLiteBackupManager {
  private backupInterval: number;
  private backupPath: string;
  
  constructor(config: BackupConfig) {
    this.backupInterval = config.interval || 3600000; // 1 hour
    this.backupPath = config.path || '/backups';
  }
  
  start(): void {
    setInterval(() => {
      this.createBackup().catch(error => {
        this.logger.error('Backup failed', { error: error.message });
      });
    }, this.backupInterval);
  }
  
  async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupPath, `storage-${timestamp}.db`);
    
    // Use SQLite BACKUP API for online backup
    await this.db.backup(backupFile);
    
    // Compress backup
    await this.compressFile(backupFile);
    
    this.logger.info('Backup created', { file: backupFile });
    return backupFile;
  }
  
  async restore(backupFile: string): Promise<void> {
    // Validate backup integrity
    const backupDb = new Database(backupFile, { readonly: true });
    const result = backupDb.pragma('integrity_check');
    backupDb.close();
    
    if (result[0].integrity_check !== 'ok') {
      throw new Error('Backup file is corrupted');
    }
    
    // Restore from backup
    fs.copyFileSync(backupFile, this.dbPath);
    this.logger.info('Database restored from backup', { file: backupFile });
  }
}
```

### Point-in-Time Recovery

```sql
-- Using WAL mode enables point-in-time recovery
PRAGMA journal_mode = WAL;

-- Checkpoint WAL periodically
PRAGMA wal_checkpoint(TRUNCATE);
```

---

## Implementation Details

### Error Handling

```typescript
export class SQLiteError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: any
  ) {
    super(message);
    this.name = 'SQLiteError';
  }
}

export class SQLiteClient {
  private handleError(error: any, context: any): never {
    const sqliteError = new SQLiteError(
      error.message,
      error.code || 'UNKNOWN',
      context
    );
    
    this.logger.error('SQLite operation failed', {
      error: error.message,
      code: error.code,
      context
    });
    
    throw sqliteError;
  }
}
```

### Health Checks

```typescript
async healthCheck(): Promise<HealthStatus> {
  try {
    // Test basic connectivity
    const result = await this.db.prepare('SELECT 1 as test').get();
    
    // Test write capability
    await this.db.prepare('INSERT OR IGNORE INTO health_check (timestamp) VALUES (?)').run(Date.now());
    
    // Check database integrity
    const integrityResult = this.db.pragma('integrity_check');
    
    return {
      status: 'healthy',
      checks: {
        connectivity: result.test === 1,
        write_capability: true,
        integrity: integrityResult[0].integrity_check === 'ok'
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}
```

### Monitoring & Metrics

```typescript
class SQLiteMetrics {
  private metrics: MetricsCollector;
  
  collectMetrics(): void {
    // Database size
    const stats = fs.statSync(this.dbPath);
    this.metrics.recordGauge('sqlite_db_size_bytes', stats.size);
    
    // WAL size
    try {
      const walStats = fs.statSync(this.dbPath + '-wal');
      this.metrics.recordGauge('sqlite_wal_size_bytes', walStats.size);
    } catch (error) {
      // WAL file may not exist
    }
    
    // Query performance
    this.metrics.recordHistogram('sqlite_query_duration', this.lastQueryDuration);
    
    // Connection count
    this.metrics.recordGauge('sqlite_active_connections', this.activeConnections);
  }
}
```

This SQLite documentation provides comprehensive coverage of the database layer's schema, operations, optimizations, and maintenance procedures for the Storage Layer system.