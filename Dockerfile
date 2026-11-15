# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
COPY deploy/check-data.mjs deploy/prepare-standalone.mjs /app/deploy/
RUN node /app/deploy/check-data.mjs \
    && npm run build \
    && test -s .next/standalone/server.js \
    && test -s .next/standalone/.next/server/app/api/select-variables/route.js \
    && test -s .next/standalone/.next/server/app/api/daily-series/route.js \
    && test -s .next/standalone/public/data/gen/catalog.json \
    && test ! -e .next/standalone/public/data/.bundle

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    SELECTOR_BACKEND=keyword
COPY --from=build --chown=node:node /app/web/.next/standalone/ ./
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node:node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz/', {signal: AbortSignal.timeout(2000)}).then(async r => {if (!r.ok || await r.text() !== 'ok\\n') process.exit(1)}).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
