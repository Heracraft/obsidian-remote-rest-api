# syntax=docker/dockerfile:1

# Build: bundle the server with esbuild. Needs the dev dependencies.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY esbuild.config.mjs tsconfig.json ./
COPY src ./src
COPY docs/openapi.yaml ./docs/openapi.yaml
RUN node esbuild.config.mjs production

# Runtime: the bundle plus sharp, the one package it loads at run time.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /src/dist ./dist

# The folder to serve. Mount it here; nothing else is required.
ENV VAULT_PATH=/vault
# 27124 is HTTPS (on by default), 27123 is HTTP (ENABLE_INSECURE_SERVER=true).
EXPOSE 27124 27123

# The image's `node` user is uid/gid 1000. Run with `user:` in compose to
# match whoever owns the mounted folder.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/server.js"]
