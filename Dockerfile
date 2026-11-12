FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
COPY web ./web
COPY vite.config.mjs ./
COPY scripts/generate-sw.mjs ./scripts/generate-sw.mjs
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3210 RIBBON_DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p data && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY LICENSE PRIVACY.md SECURITY.md ./
USER node
EXPOSE 3210
VOLUME ["/app/data"]
CMD ["node", "src/server/index.mjs"]
