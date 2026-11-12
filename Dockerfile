# Always-on dashboard: the same server as the npm package (`lib/server/cli.js`),
# which serves the built app and the `/api` routes, reads the transcripts and
# writes the data dir (both mounted).
# `dist/` and `lib/` do not depend on the platform and the final stage has no `RUN`, so a
# multi-arch build compiles once, natively, and needs no emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:lib

# The server has no runtime dependency: `dist/` bundles the dashboard and
# `lib/` is plain JavaScript, so no `node_modules` ships. The CLI reads
# `package.json` for its name and version.
FROM node:24-alpine
WORKDIR /app
ENV CLAUDE_CONFIG_DIR=/claude \
  CCA_DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/lib ./lib
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "lib/server/cli.js", "start", "--host", "0.0.0.0", "--port", "4173", "--no-open"]
