# Multi-stage build: frontend assets + nginx runtime

FROM node:20-alpine AS frontend-build
WORKDIR /app

# Install dependencies for building
COPY ./frontend/package*.json ./frontend/
RUN cd ./frontend && npm install

# Copy source and build
COPY ./frontend ./frontend
RUN cd ./frontend && npm run build


FROM nginx:alpine

# Remove default config and prepare directories
RUN rm /etc/nginx/nginx.conf && mkdir -p /usr/share/nginx/html && mkdir -p /etc/nginx/ssl

# Copy custom configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy frontend build output
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Expose port 80 (and 443 for future HTTPS)
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
