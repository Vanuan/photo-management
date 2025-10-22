# Production Dockerfile for Worker Service
# This Dockerfile is used for production builds and should be built from the root context

FROM node:20-alpine

WORKDIR /app

# Install system dependencies for Sharp
RUN apk add --no-cache python3 make g++ vips-dev

# Copy necessary package files for dependency installation
COPY package*.json ./
COPY worker/package*.json ./worker/
COPY shared-infra ./shared-infra/

# Install production dependencies only
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code
COPY worker ./worker/
COPY shared-infra ./shared-infra/

# Build the worker
WORKDIR /app/worker
RUN npm run build

# Set working directory back to app root
WORKDIR /app

# Start the worker
CMD ["node", "worker/dist/index.js"]
