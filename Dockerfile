# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy source and build
COPY server.js server.js
COPY public/ ./public/

# Production stage
FROM node:18-alpine AS runner

# Create app user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/public/ ./public/

# Install production deps only
RUN npm ci --only=production && npm cache clean --force

# Ensure app user has ownership
RUN chown -R app:app /app && \
    chmod +x server.js

USER app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

EXPOSE 8080

CMD ["node", "server.js"]