FROM node:20-alpine AS base

WORKDIR /app

# Install system dependencies for Sharp
RUN apk add --no-cache python3 make g++ vips-dev

# Copy package files
COPY package.json package-lock.json* ./
COPY worker/package.json ./worker/

# Install dependencies
RUN npm ci

# Copy source code
COPY worker ./worker
COPY shared-infra ./shared-infra

# Build
WORKDIR /app/worker
RUN npm run build || tsc || echo "No build script found"

# Start the worker
CMD ["node", "dist/index.js"]
