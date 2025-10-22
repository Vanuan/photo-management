# Production Dockerfile for Worker Service - Multistage Build
# This Dockerfile is used for production builds and should be built from the root context

# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace configuration
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files
# This ensures npm can resolve the entire workspace structure
COPY worker/package*.json ./worker/
COPY packages/event-bus/package*.json ./packages/event-bus/
COPY packages/job-queue/package*.json ./packages/job-queue/
COPY packages/storage-client/package*.json ./packages/storage-client/
COPY packages/storage-core/package*.json ./packages/storage-core/

# Install all dependencies
RUN npm ci

# Copy source code
COPY worker ./worker
COPY packages ./packages

# Build shared packages first (dependencies)
RUN npm run build -w @shared-infra/event-bus --if-present
RUN npm run build -w @shared-infra/job-queue --if-present
RUN npm run build -w @shared-infra/storage-client --if-present
RUN npm run build -w @shared-infra/storage-core --if-present

# Build worker (depends on shared packages)
RUN npm run build -w worker

# Stage 2: Production runtime
FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init vips-dev

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files needed for npm install in production
COPY package.json package-lock.json ./
COPY worker/package*.json ./worker/
COPY packages/event-bus/package*.json ./packages/event-bus/
COPY packages/job-queue/package*.json ./packages/job-queue/
COPY packages/storage-client/package*.json ./packages/storage-client/
COPY packages/storage-core/package*.json ./packages/storage-core/

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# Copy built artifacts
COPY --from=builder --chown=nodejs:nodejs /app/worker/dist ./worker/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/event-bus/dist ./packages/event-bus/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/job-queue/dist ./packages/job-queue/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/storage-client/dist ./packages/storage-client/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/storage-core/dist ./packages/storage-core/dist

USER nodejs

ENTRYPOINT ["dumb-init", "--"]

CMD ["npm", "run", "start", "-w", "worker"]
