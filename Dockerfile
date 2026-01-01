# ==================================================
# Ali Backend - Production Dockerfile
# Dockerfile احترافي للإنتاج
# ==================================================

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files first (for better caching)
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm run build

# Remove devDependencies
RUN npm prune --production

# ==================================================
# Production stage
# ==================================================
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs

# Create directories for logs and uploads
RUN mkdir -p /app/logs /var/www/uploads && \
    chown -R nestjs:nodejs /app /var/www/uploads

# Copy built files from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Use non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

# Start with dumb-init for proper signal handling
CMD ["dumb-init", "node", "dist/main"]
