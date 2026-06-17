FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

# ---- deps stage ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY apps/server/package.json ./apps/server/
COPY apps/client/package.json ./apps/client/
RUN pnpm install --frozen-lockfile

# ---- build stage ----
FROM deps AS build
WORKDIR /app
COPY packages/core/ ./packages/core/
COPY apps/server/ ./apps/server/
COPY apps/client/ ./apps/client/
RUN pnpm build

# ---- runtime stage ----
FROM node:24-slim AS runtime
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

WORKDIR /app

# Copy workspace manifests and lockfile for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/
COPY apps/server/package.json ./apps/server/
# Client is only needed as static files at runtime, not its node_modules
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist

# DATA_DIR is where the SQLite file lives — mount a Dokku volume here
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "--experimental-sqlite", "apps/server/dist/index.js"]
