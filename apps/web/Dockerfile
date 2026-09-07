# Production image for the frontend — `05-infrastructure.md` §2, §3.1;
# `IMPLEMENTATION_PLAN.md` §22.8.
#
# Two stages: Node builds the static bundle, Nginx serves it. The runtime image
# contains no Node and no source — just the built assets and a web server, which
# is both smaller and a smaller attack surface.

# --- Build --------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace apps/web --include-workspace-root

COPY apps/web ./apps/web

# Vite inlines `VITE_*` at BUILD time, not at run time — so the API base URL is a
# build argument, and a different backend origin means a different image. That is
# a property of static builds, not an oversight.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build --workspace apps/web

# --- Runtime ------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Replaces the default server block. The app config is mounted or copied by the
# deployment (see `deploy/nginx/`), so this image serves correctly on its own
# while still allowing the TLS-terminating front to be configured separately.
COPY deploy/nginx/app.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/conf.d/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
