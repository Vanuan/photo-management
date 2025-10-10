# Multi-stage Dockerfile for Storage Service

# Development stage
FROM node:18-alpine AS development

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    curl

# Copy package files for dependency installation
COPY package*.json ./
COPY packages/storage-core/package*.json ./packages/storage-core/
COPY packages/storage-service/package*.json ./packages/storage-service/

# Install all dependencies including dev dependencies
RUN npm install

# Copy source code
COPY packages/storage-core ./packages/storage-core
COPY packages/storage-service ./packages/storage-service

# Create data directory and set permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app/data && \
    chmod 755 /app/data

# Development command
CMD ["npm", "run", "dev", "--workspace=@shared-infra/storage-service"]

# Builder stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite

# Copy package files
COPY package*.json ./
COPY packages/storage-core/package*.json ./packages/storage-core/
COPY packages/storage-service/package*.json ./packages/storage-service/

# Install all dependencies
RUN npm install

# Copy source code
COPY packages/storage-core ./packages/storage-core
COPY packages/storage-service ./packages/storage-service

# Build the packages
RUN npm run build --workspace=@shared-infra/storage-core
RUN npm run build --workspace=@shared-infra/storage-service

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    curl \
    tini

WORKDIR /app

# Copy package files for production dependencies only
COPY package*.json ./
COPY packages/storage-core/package*.json ./packages/storage-core/
COPY packages/storage-service/package*.json ./packages/storage-service/

# Install production dependencies only
RUN npm install --omit=dev --no-audit --no-fund

# Copy built application from builder stage
COPY --from=builder /app/packages/storage-core/dist ./packages/storage-core/dist
COPY --from=builder /app/packages/storage-core/migrations ./packages/storage-core/migrations
COPY --from=builder /app/packages/storage-service/dist ./packages/storage-service/dist

# Create data directory with proper permissions
RUN mkdir -p /app/data && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app/data && \
    chmod 755 /app/data

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health/live || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the service
CMD ["node", "packages/storage-service/dist/server.js"]

# Metadata
LABEL maintainer="Your Organization <your-email@example.com>"
LABEL version="1.0.0"
LABEL description="Storage Service for Photo Management System"
LABEL org.opencontainers.image.title="Storage Service"
LABEL org.opencontainers.image.description="Deployable storage service handling photo storage operations"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="Your Organization"
LABEL org.opencontainers.image.licenses="MIT"
