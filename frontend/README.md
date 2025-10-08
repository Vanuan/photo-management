# Frontend (Vite + React) — Dev Proxy & Environment Setup

This frontend is a Vite + React app. The development server is configured to proxy API requests to the api-gateway to avoid CORS and to keep backend URLs out of the code.

- Dev server runs on http://localhost:5173
- API requests go to `/api/...` and are proxied to `http://localhost:3000`
- Socket.IO WebSocket connects to `ws://localhost:3000` (configurable)

## Quick start (local)

Terminal 1 — backend services:

```bash
docker-compose up redis minio storage-service api-gateway
```

Terminal 2 — frontend with hot reload:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## How the proxy works (development)

Vite is configured to proxy requests in development so the browser thinks everything is served from the same origin:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // api-gateway
        changeOrigin: true,
        secure: false,
        ws: false, // WebSocket handled separately
      },
      // Socket.IO endpoint
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      }
    }
  }
})
```

- Any browser request to `http://localhost:5173/api/*` is forwarded to `http://localhost:3000/api/*`.
- Socket.IO traffic under `/socket.io` is forwarded to the backend as WebSocket traffic.

## Environment variables

Create these files in `frontend/` (already added to the repo):

`.env.development`
```
VITE_WEBSOCKET_URL=ws://localhost:3000
VITE_API_BASE_URL=/api
```

`.env.production`
```
VITE_WEBSOCKET_URL=wss://your-domain.com
VITE_API_BASE_URL=/api
```

`.env.example`
```
# WebSocket connection URL for real-time events
VITE_WEBSOCKET_URL=ws://localhost:3000

# API base URL (proxied in development, direct in production)
VITE_API_BASE_URL=/api
```

Notes:
- `VITE_API_BASE_URL` is set to `/api` so that in development it routes through the Vite proxy. In production use your reverse proxy (e.g., Nginx/Traefik) to forward `/api` to the api-gateway.
- `VITE_WEBSOCKET_URL` controls the Socket.IO connection URL.

## Current service usage

- UploadManager posts to `/api/photos/upload` — no code changes needed for development since the proxy handles it.
- WebSocketClient uses `VITE_WEBSOCKET_URL` with a fallback to `ws://localhost:3000` for development.

## Testing the setup

1. Start backend services (see Quick start) and ensure api-gateway listens on port 3000.
2. In `frontend`, run `npm run dev` and open http://localhost:5173.
3. Verify `http://localhost:5173/api/photos/upload` is proxied to `http://localhost:3000/api/photos/upload` without CORS errors.
4. Check the browser console: WebSocket connects to `ws://localhost:3000`.
5. Run a photo upload and confirm the end-to-end flow works in development (upload, process events, completion).

## Docker / Production

When running via docker-compose or in production, the Vite dev proxy is not used.

- Frontend should call the api-gateway through a reverse proxy. Commonly, you expose the frontend at `https://your-domain.com` and configure your proxy to forward:
  - `https://your-domain.com/api` → api-gateway service
  - `https://your-domain.com/socket.io` → api-gateway (WebSocket)
- Inside a Docker network, the backend can be addressed by its service name. Inject environment variables at container runtime:
  - `VITE_WEBSOCKET_URL=ws://api-gateway:3000`
  - `VITE_API_BASE_URL=/api` (kept as `/api` if you terminate/route at the reverse proxy)
- Optionally, update your WebSocket client logic to derive a production URL from `window.location.origin` if you prefer not to pass it via environment variables.

## Scripts

- `npm run dev` — start Vite dev server (5173)
- `npm run build` — production build
- `npm run preview` — preview production build locally

## Troubleshooting

- CORS errors in development: ensure requests use `/api/...` paths and that the Vite dev server is running. Avoid hardcoding `http://localhost:3000` in the frontend code in dev.
- WebSocket not connecting: confirm api-gateway exposes Socket.IO on port 3000 and that no firewall blocks WebSocket traffic. In dev, ensure `VITE_WEBSOCKET_URL=ws://localhost:3000`.
- Port conflicts: if 5173 is busy, adjust `server.port` in `vite.config.ts`.
