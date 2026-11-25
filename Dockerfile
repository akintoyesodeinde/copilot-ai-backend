FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npx prisma generate && npm run build

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nextjs
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/v1/health/live || exit 1

CMD ["node", "server.js"]
