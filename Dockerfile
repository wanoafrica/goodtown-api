# syntax=docker/dockerfile:1
# Goodtown API — Hono on Node 22. Build: docker build -t goodtown-api .   Run: see docker-compose.yml
# For reproducible production builds pin the base image by digest, e.g.
#   docker build --build-arg NODE_IMAGE=node:22-alpine@sha256:<digest> .
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
