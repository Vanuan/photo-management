FROM node:20-alpine AS build

WORKDIR /app

# Copy shared packages and api-gateway for local file deps
COPY ./shared-infra ./shared-infra
COPY ./api-gateway ./api-gateway

# Install and build api-gateway
WORKDIR /app/api-gateway
RUN npm install && npm run build


FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/api-gateway/package*.json ./
COPY --from=build /app/api-gateway/node_modules ./node_modules
COPY --from=build /app/api-gateway/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
