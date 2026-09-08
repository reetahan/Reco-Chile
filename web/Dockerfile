# Next.js frontend. Build from THIS directory (the context is web/):
#
#   docker build -t reco-chile-web web/
#   docker run --rm -p 3000:3000 -e API_BASE_URL=http://host.docker.internal:8000 reco-chile-web
#
# Normally started through ../docker-compose.yml, which wires it to the api
# service. Three stages so the runtime image carries neither the sources nor a
# package manager: deps -> builder -> runner.

# ---------------------------------------------------------------------------
# deps — node_modules only, cached until the lockfile changes
# ---------------------------------------------------------------------------
# Node 22 (LTS); the floor in package.json is >=20.
FROM node:22-bookworm-slim AS deps
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: @playwright/test is a devDependency and its
# browsers are e2e-only. pnpm already blocks unapproved install scripts; this
# makes it explicit and keeps the layer small.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# corepack ships with Node 22 and installs exactly the pnpm version pinned in
# package.json's `packageManager` field.
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — produces .next/standalone
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No API_BASE_URL here: every wizard route is server-rendered on demand, so the
# build never calls the backend, and the value is read at request time only
# (lib/api/proxy.ts, lib/meta/). Nothing about the Python origin is baked in.
RUN pnpm build

# ---------------------------------------------------------------------------
# runner — node server.js, no package manager, no sources
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_BASE_URL=http://api:8000
WORKDIR /app

# `output: "standalone"` (next.config.ts) traces the runtime files into
# .next/standalone, including a minimal node_modules and the server entry point.
# The two asset trees it deliberately leaves out are copied next to it.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# `node` (uid 1000) exists in the base image; the app writes nothing to disk.
USER node
EXPOSE 3000

# Started by the standalone server itself — no `next start`, no pnpm.
CMD ["node", "server.js"]
