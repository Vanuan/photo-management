# Nginx Reverse Proxy Configuration

This directory contains Nginx configuration files for the Photo Management System production deployment.

## Overview

The Nginx reverse proxy serves as the single entry point for the entire application in production, handling:

- **Static File Serving**: Serves the React frontend from `/usr/share/nginx/html`
- **API Proxying**: Routes `/api/*` requests to the api-gateway service
- **WebSocket Proxying**: Routes `/socket.io/*` connections for real-time events
- **Security**: Implements CORS, CSP, rate limiting, and security headers
- **Compression**: Gzip compression for text-based assets
- **Caching**: Appropriate cache headers for static assets and SPA routing

## Files

### nginx.conf
Main configuration file for HTTP-only deployments (development/staging).

Features:
- Reverse proxy to api-gateway:3000
- Rate limiting (100 req/s for API, 10 req/s for uploads)
- CORS headers
- Security headers (X-Frame-Options, CSP, etc.)
- Gzip compression
- WebSocket upgrade support
- SPA fallback routing

### ssl-nginx.conf
Example configuration for HTTPS deployments with Let's Encrypt certificates.

Additional features:
- HTTP to HTTPS redirect
- SSL/TLS configuration (TLS 1.2+)
- OCSP stapling
- HSTS header
- ACME challenge support for certificate renewal

### Dockerfile
Multi-stage build:
1. **Build stage**: Compiles frontend React app
2. **Production stage**: Nginx Alpine with built assets and configuration

## Usage

### HTTP Deployment (Development/Staging)

```bash
# Build and run with docker-compose
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Or with profile
docker-compose --profile production up -d
```

The application will be available at `http://localhost`.

### HTTPS Deployment (Production)

1. **Obtain SSL certificates** using Let's Encrypt:
   ```bash
   certbot certonly --standalone -d your-domain.com -d www.your-domain.com
   ```

2. **Update docker-compose.prod.yml** to mount certificates:
   ```yaml
   nginx:
     volumes:
       - /etc/letsencrypt/live/your-domain.com/fullchain.pem:/etc/nginx/ssl/fullchain.pem:ro
       - /etc/letsencrypt/live/your-domain.com/privkey.pem:/etc/nginx/ssl/privkey.pem:ro
   ```

3. **Replace nginx.conf with ssl-nginx.conf** in the Dockerfile:
   ```dockerfile
   COPY nginx/ssl-nginx.conf /etc/nginx/conf.d/default.conf
   ```

4. **Update your-domain.com** in ssl-nginx.conf to your actual domain.

5. **Update frontend/.env.production**:
   ```bash
   VITE_WEBSOCKET_URL=wss://your-domain.com/socket.io
   VITE_API_BASE_URL=/api
   ```

6. **Rebuild and deploy**:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml build nginx
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

## Configuration Details

### Upstream Backend
```nginx
upstream api_backend {
    server api-gateway:3000;
    keepalive 32;
}
```

### Rate Limiting
- **API requests**: 100 requests/second, burst of 20
- **Photo uploads**: 10 requests/second, burst of 5
- **Connection limit**: 10 concurrent connections per IP

### Timeouts
- **Standard API**: 60s connect, 300s send/read
- **Photo uploads**: 60s connect, 600s send/read
- **WebSockets**: 7 days (maintained connections)

### Compression
Gzip enabled for:
- Text formats (HTML, CSS, JS, JSON, XML)
- Minimum size: 1024 bytes
- Compression level: 6

### Caching Strategy
- **Static assets** (JS, CSS, images): 1 year, immutable
- **index.html**: No cache (ensures updates are loaded)
- **Service workers**: No cache
- **Manifest files**: 1 day

### Security Headers
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (configured for local development)
- `Strict-Transport-Security` (HTTPS only, 2 years)

## Health Checks

The nginx service exposes a `/health` endpoint that returns a 200 status:
```bash
curl http://localhost/health
# Response: healthy
```

## Troubleshooting

### Frontend not loading
- Check if nginx container is running: `docker ps | grep nginx`
- Check nginx logs: `docker-compose logs nginx`
- Verify build was successful: `docker-compose build nginx`

### API requests failing
- Verify api-gateway is healthy: `curl http://localhost/api/health`
- Check api-gateway logs: `docker-compose logs api-gateway`
- Verify network connectivity between services

### WebSocket connection issues
- Check browser console for WebSocket errors
- Verify Socket.IO is running on api-gateway
- Check CORS headers in browser network tab
- For HTTPS: ensure wss:// protocol is used

### Rate limiting
If you're hitting rate limits during testing:
- Increase `rate` in `limit_req_zone` directives
- Increase `burst` values in location blocks
- Or disable rate limiting temporarily:
  ```nginx
  # Comment out limit_req lines in nginx.conf
  # limit_req zone=api_limit burst=20 nodelay;
  ```

## Development

To modify the nginx configuration:

1. Edit `nginx/nginx.conf`
2. Rebuild the nginx container:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml build nginx
   ```
3. Restart the service:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx
   ```

To test configuration syntax:
```bash
docker run --rm -v $(pwd)/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.25-alpine nginx -t
```

## Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ HTTP/HTTPS
       │
┌──────▼──────┐
│    Nginx    │  :80 / :443
│   Reverse   │
│    Proxy    │
└──────┬──────┘
       │
       ├─────────────────┐
       │                 │
       │ /api/*          │ /socket.io/*
       │                 │
┌──────▼──────┐   ┌──────▼──────┐
│ API Gateway │   │  WebSocket  │
│   :3000     │   │   (Socket.IO)│
└─────────────┘   └─────────────┘
```

## Notes

- The nginx service only runs in production mode (profile: production)
- In development, the frontend container serves files directly on port 5173
- The Dockerfile includes a multi-stage build to minimize final image size
- All internal services (api-gateway, storage-service) are not exposed externally in production
- Only nginx port 80/443 is accessible from outside the Docker network
