# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
COPY deploy/check-data.mjs /app/deploy/check-data.mjs
RUN node /app/deploy/check-data.mjs \
    && npm run build \
    && test -s out/index.html \
    && test -s out/404.html \
    && test -s out/data/gen/catalog.json \
    && rm -f out/data/.bundle

FROM nginx/nginx-unprivileged:1.30.6-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/out/ /usr/share/nginx/html/

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# The configuration is complete; skip entrypoint scripts that rewrite it at startup.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
