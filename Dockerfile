FROM node:20-alpine AS base
# Cache bust: v3
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Build TypeScript
FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src src
RUN npm run build

# Production image
FROM base AS release

# Install su-exec for dropping privileges
RUN apk add --no-cache su-exec

# Copy production dependencies
COPY --from=deps /app/node_modules node_modules

# Copy built files
COPY --from=build /app/dist dist

# Copy static assets and views
COPY public public
COPY src/views dist/views

COPY package.json .

# Copy and set up entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create data and custom-templates directories
RUN mkdir -p data custom-templates && chown -R node:node data custom-templates

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
