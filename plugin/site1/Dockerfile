# Multi-stage build: Build with Node.js, serve with nginx
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies (prefer reproducible ci, fallback to install if no lock file)
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
			echo "Using npm ci (lock file detected)" && npm ci --omit=dev; \
		else \
			echo "No lock file found; using npm install (non-reproducible)" && npm install --omit=dev; \
		fi

# Copy all source files
COPY . .

# Build the React application
RUN CI=false DISABLE_ESLINT_PLUGIN=true npm run build

# Production stage: Use nginx to serve the built files
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]