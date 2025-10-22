-- Core photo metadata table
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

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_photos_client_id ON photos(client_id);
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_processing_status ON photos(processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_photos_bucket_key ON photos(bucket, s3_key);
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS photos_search USING fts5(
  photo_id UNINDEXED,
  filename,
  mime_type,
  content='photos',
  content_rowid='rowid'
);

-- Triggers for timestamp updates
CREATE TRIGGER IF NOT EXISTS update_photos_timestamp
  AFTER UPDATE ON photos
BEGIN
  UPDATE photos SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Triggers for search index
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
