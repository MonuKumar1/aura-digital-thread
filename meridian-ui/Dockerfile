# Build context is the repo root so the shared ./data directory is available to the Vite build.
FROM node:20-alpine AS build
WORKDIR /src/meridian-ui
COPY meridian-ui/package.json meridian-ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY meridian-ui/ ./
COPY data /src/data
RUN npm run build

FROM nginx:1.27-alpine
COPY meridian-ui/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY meridian-ui/docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh
COPY --from=build /src/meridian-ui/dist /usr/share/nginx/html
EXPOSE 80
