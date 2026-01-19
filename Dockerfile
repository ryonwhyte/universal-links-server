FROM node:20-alpine AS base
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

# Copy production dependencies
COPY --from=deps /app/node_modules node_modules

# Copy built files
COPY --from=build /app/dist dist

# Copy static assets and views
COPY public public
COPY src/views dist/views

COPY package.json .

# Create data and custom-templates directories
RUN mkdir -p data custom-templates && chown -R node:node data custom-templates

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "dist/index.js"]
