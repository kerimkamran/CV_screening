# Single-service image for Render: the API also serves the built web app.
#   docker build -f docker/render.Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w packages/shared && npm run build -w apps/api && npm run build -w apps/web \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
# poppler-utils provides pdftotext, used to read PDF CVs.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /repo/apps/web/dist apps/web/dist
COPY --chown=node:node db/migrations db/migrations
COPY --chown=node:node scripts/migrate.mjs scripts/render-start.mjs scripts/
ENV WEB_DIST_DIR=/repo/apps/web/dist
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/render-start.mjs"]
