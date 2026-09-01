# ── STAGE 1: Base & Dependencies ──────────────────────
FROM node:24-alpine AS deps
WORKDIR /app

# Install libc6-compat for Alpine compatibility with native binaries
RUN apk add --no-cache libc6-compat

# Copy package management files & Prisma schema
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install dependencies (including devDeps for build) and generate Prisma client
RUN npm ci
RUN npx prisma generate

# ── STAGE 2: Build Application ────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Set environment variables for production build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js in standalone mode
RUN npm run build

# ── STAGE 3: Production Runner ────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Add non-root system user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets & models
COPY --from=builder /app/public ./public

# Copy standalone server build & static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Set permissions
USER nextjs

EXPOSE 3000

# Start Next.js standalone server
CMD ["node", "server.js"]
