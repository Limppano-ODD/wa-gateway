# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Create media directory for file uploads
RUN mkdir -p media

# Expose port
EXPOSE 5001

# Set environment variables
ENV NODE_ENV=PRODUCTION
ENV PORT=5001

# Start the application
CMD ["pnpm", "start"]
