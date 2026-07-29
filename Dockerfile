# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package configuration and prisma schema first
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including devDependencies for building code)
RUN npm ci

# Set a dummy DATABASE_URL environment variable for build-time prisma commands
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Generate Prisma Client
RUN npx prisma generate

# Copy rest of application code
COPY . .

# Build the NestJS application
RUN npm run build

# Stage 2: Production run environment
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Copy package files for reference/metadata
COPY package*.json ./

# Copy built application, node_modules (with generated Prisma Client), and prisma folder (needed for migrations)
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/prisma ./prisma

# Copy the startup script and make it executable
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose port and configure environment defaults
ENV PORT=3000
EXPOSE 3000

# Set entrypoint to run migrations before launching application
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
