# Multi-stage build for WhatsApp Gateway
# Node 22: o pnpm 11 (fixado no packageManager) usa módulo builtin que não
# existe no Node 20 — o build da imagem quebrava com ERR_UNKNOWN_BUILTIN_MODULE.
# Casado com o node-version do CI.
FROM node:22-alpine AS base

# Install pnpm
# Versão FIXA: `npm i -g pnpm` pega a latest, então dois builds em datas
# diferentes podiam resolver dependências de formas diferentes — foi assim que o
# audio-decode saiu do lockfile sem ninguém decidir. Casada com o
# `packageManager` do package.json.
RUN npm install -g pnpm@11.1.3

# Build stage
FROM base AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Production stage
FROM base AS production

WORKDIR /app

# Install necessary system dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy source code from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create directories for mounted volumes
RUN mkdir -p /app/wa_credentials /app/media /app/db

# Expose port 3002
EXPOSE 3002

# Set environment variable for production
ENV NODE_ENV=PRODUCTION
ENV PORT=3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["pnpm", "start"]
