# Production Dockerfile for API Gateway
# This Dockerfile is used for production builds and should be built from the root context

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy necessary package files for dependency installation
COPY package*.json ./
COPY api-gateway/package*.json ./api-gateway/
COPY shared-infra/packages/event-bus/package*.json ./shared-infra/packages/event-bus/
COPY shared-infra/packages/job-queue/package*.json ./shared-infra/packages/job-queue/
COPY shared-infra/packages/storage-client/package*.json ./shared-infra/packages/storage-client/
COPY shared-infra/packages/storage-core/package*.json ./shared-infra/packages/storage-core/

# Install production dependencies only
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code
COPY api-gateway ./api-gateway/
COPY shared-infra/packages/event-bus ./shared-infra/packages/event-bus/
COPY shared-infra/packages/job-queue ./shared-infra/packages/job-queue/
COPY shared-infra/packages/storage-client ./shared-infra/packages/storage-client/
COPY shared-infra/packages/storage-core ./shared-infra/packages/storage-core/

# Set working directory to API gateway
WORKDIR /app/api-gateway

# Expose port
EXPOSE 3000

# Start the service using the pre-built files
CMD ["npm", "start"]
