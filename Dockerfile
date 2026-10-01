# syntax=docker/dockerfile:1

# ---- build: compile the app and the native SQLite driver ----
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

# Toolchain only for better-sqlite3's source fallback when no prebuilt
# binary matches the platform. It never reaches the runtime image.
# hadolint ignore=DL3008
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# No install scripts except the one native module that needs its own.
RUN --mount=type=cache,target=/root/.npm \
	npm ci --ignore-scripts \
	&& npm rebuild better-sqlite3

COPY . .
RUN npm run build \
	&& npm prune --omit=dev \
	&& mkdir /data

# ---- runtime: distroless, non-root, no shell ----
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="Filmnacht" \
	org.opencontainers.image.description="Self-hosted movie nights for small groups, with a fair draw." \
	org.opencontainers.image.source="https://github.com/xFuture603/filmnacht" \
	org.opencontainers.image.licenses="MIT" \
	org.opencontainers.image.version="${VERSION}" \
	org.opencontainers.image.revision="${REVISION}" \
	org.opencontainers.image.created="${CREATED}"

WORKDIR /app
ENV NODE_ENV=production \
	DATABASE_PATH=/data/filmnacht.db \
	PORT=3000 \
	HOST=0.0.0.0

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
# Owned by the runtime user so a fresh named volume inherits a writable /data.
COPY --from=build --chown=65532:65532 /data /data

USER 65532:65532
EXPOSE 3000
VOLUME ["/data"]

# No curl in distroless: the image's own node does the request. /login
# redirects to /setup on a fresh instance; fetch follows, so that is healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The distroless entrypoint is node; adapter-node handles SIGTERM itself.
CMD ["build"]
