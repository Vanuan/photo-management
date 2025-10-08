# Photo Capture MVP - Functional Requirements & Implementation Guide

## User Stories

### US-001: Photo Capture
**As a** Mobile User
**I want to** Quickly capture multiple photos in sequence
**So that** I can document items/scenes efficiently without interruption

**Acceptance Criteria:**
- Camera interface loads within 2 seconds
- Back camera is default (environment facing)
- Capture button is large and easily tappable
- High resolution capture (1920x1080 minimum)
- Consecutive photos without delay
- Immediate preview after capture
- Option to retake or continue

**Technical Requirements:**
- getUserMedia() API with facingMode: environment
- Canvas-based photo capture
- Blob storage for preview
- Auto-continue after 2-second preview

**Priority:** MUST-HAVE

### US-002: Local Caching
**As a** Mobile User
**I want to** Photos stored locally first
**So that** I can continue capturing with poor network connectivity

**Acceptance Criteria:**
- Immediate local caching after capture
- Cache persists across browser sessions
- Status tracking (cached, uploading, uploaded, error)
- Auto cleanup after successful upload
- Max cache size: 100MB
- Queue status visibility and retry controls

**Technical Requirements:**
- localStorage for metadata
- Blob URLs for temporary storage
- Queue persistence across refresh
- Automatic cache cleanup

**Priority:** MUST-HAVE

### US-003: Background Upload
**As a** Mobile User
**I want to** Automatic background photo upload
**So that** I can continue taking photos without waiting

**Acceptance Criteria:**
- Upload starts immediately after capture
- Max 3 concurrent uploads
- Upload continues during navigation
- Progress indicator visible
- Max 5 retry attempts
- Exponential backoff (1s, 2s, 4s, 8s, 16s)
- Network status detection

**Technical Requirements:**
- Upload queue with priority
- RESTful API endpoint
- Multipart form data
- Retry logic with backoff
- Network connectivity monitoring

**Priority:** MUST-HAVE

### US-004: Real-time Status
**As a** Mobile User
**I want to** See real-time upload progress
**So that** I know when photos are safely stored

**Acceptance Criteria:**
- Percentage complete for uploads
- Queue displays status of each photo
- Real-time completion notifications
- Visual state indicators
- Upload speed estimates
- Clear, actionable error messages

**Technical Requirements:**
- WebSocket connection
- Progress tracking during upload
- Event-driven status updates
- Visual progress bars and icons

**Priority:** MUST-HAVE

## Functional Requirements

### FR-001: Photo Storage Service
Secure, scalable photo storage with S3-compatible API

**Features:**
- Store photos in MinIO (S3-compatible)
- Generate unique photo IDs (UUID)
- Store metadata (filename, size, timestamp, MIME)
- Secure access URLs
- JPEG with configurable compression
- Thumbnail generation (future)

**API Endpoints:**
- `POST /api/photos/upload` - Upload single photo
- `GET /api/photos` - List all photos (paginated)
- `GET /api/photos/:id` - Get photo metadata
- `GET /api/photos/:id/download` - Download photo file
- `DELETE /api/photos/:id` - Delete photo (admin)

**Priority:** MUST-HAVE

### FR-002: Event System
Event-driven architecture for extensible processing

**Features:**
- Publish events on successful upload
- WebSocket broadcasting for clients
- Event payload with metadata and URLs
- Pluggable event handlers
- Event logging for analytics

**Event Types:**
- `photo.uploaded` - Photo successfully stored
- `photo.upload.failed` - Upload failed with error
- `photo.deleted` - Photo removed from system

**Priority:** MUST-HAVE

### FR-003: Metadata Management
Structured storage and retrieval of photo metadata

**Features:**
- SQLite database for metadata
- Indexed queries for fast retrieval
- ACID compliance
- Backup and recovery capabilities
- Schema versioning

**Database Schema:**
- id (UUID primary key)
- filename, s3_key, s3_url
- mime_type, file_size
- width, height (optional)
- uploaded_at, created_at
- metadata (JSON extensible)
- processing_status (for future LLM)

**Priority:** MUST-HAVE

## Non-Functional Requirements

### Performance
- **Photo capture response:** <500ms (Button press to preview)
- **Upload initiation:** <1 second (After capture)
- **API response time:** <2 seconds (Upload endpoint)
- **Gallery loading:** <3 seconds (For 20 photos)
- **Memory usage:** <100MB (Total in browser)
- **Battery impact:** Minimal (Pause when backgrounded)

### Reliability
- **Upload success rate:** >95% (Normal network conditions)
- **Data persistence:** 99.9% (Cached photos reliability)
- **Error recovery:** Automatic (Retry with notification)
- **Offline capability:** Full support (Queue and retry)

### Scalability
- **Concurrent users:** 10+ (Simultaneous clients)
- **Storage capacity:** 1TB+ (Photo storage)
- **Upload throughput:** 50+/min (Per client)
- **Database performance:** <100ms (Query response)

### Security
- **Network encryption:** HTTPS/TLS (All API communication)
- **File validation:** Full (MIME type and size)
- **Access control:** Basic auth (Admin endpoints)
- **Data sanitization:** Complete (Input validation)

## Scope Definition

### ✅ Must Have (MVP Core)
- Mobile camera interface with photo capture
- Local caching with localStorage + blob URLs
- Background upload to MinIO S3 storage
- Real-time upload status via WebSockets
- Basic photo gallery (list view)
- Offline support with automatic retry
- SQLite metadata storage
- Docker deployment configuration

### ⚠️ Nice to Have (Limited Scope)
- Image compression before upload
- Advanced error handling and feedback
- Upload progress bars with percentage
- Photo metadata display (EXIF, timestamp)
- Basic search/filter in gallery

### ❌ Out of Scope (Future Versions)
- User authentication and authorization
- Photo editing capabilities
- LLM integration for photo analysis
- Advanced gallery features (albums, tags)
- Multi-user collaboration
- Cloud deployment and scaling
- Advanced analytics and monitoring
- Photo sharing and export features

## Acceptance Test Scenarios

### Happy Path Photo Capture
**Test Steps:**
1. User opens app on mobile device
2. Grants camera permission
3. Camera preview loads within 2 seconds
4. User taps capture button
5. Photo preview appears immediately
6. Photo begins uploading in background
7. Upload completes within 30 seconds
8. Photo appears in gallery view
9. Success notification appears

**Expected Result:** Photo successfully captured, uploaded, and displayed

### Offline Photo Capture
**Test Steps:**
1. User opens app while offline
2. Captures 3 photos in succession
3. Photos are cached locally
4. Queue shows "cached" status
5. Network connection restored
6. All photos begin uploading automatically
7. Queue status updates to "uploaded"
8. Photos appear in gallery

**Expected Result:** Offline photos queued and uploaded when connectivity returns

### Upload Failure Recovery
**Test Steps:**
1. User captures photo during poor network
2. Initial upload attempt fails
3. Photo status shows "error" with countdown
4. System automatically retries after delay
5. After 3rd retry, upload succeeds
6. Photo appears in gallery
7. Queue is cleaned up

**Expected Result:** Failed uploads automatically retried and eventually succeed

### Bulk Photo Session
**Test Steps:**
1. User captures 20 photos in 5 minutes
2. Each photo cached immediately
3. Multiple uploads happen concurrently
4. Queue shows accurate status
5. No UI lag or memory issues
6. All photos upload successfully
7. Gallery displays all 20 photos

**Expected Result:** System handles bulk capture without performance degradation
