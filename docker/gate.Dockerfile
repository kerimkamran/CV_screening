# Stage 3, S3-OPS-04: the image of the TEMPORARY gate copy (render.gate.yaml). It is
# docker/render.Dockerfile plus the gate launcher, the fake AI, the one fake Oracle and its loader,
# and the `typescript` package the loader needs. The production image is unchanged and holds no file
# under e2e/ or apps/api/src/testing/.
#   docker build -f docker/gate.Dockerfile .
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
 && cp -r node_modules/typescript /tmp/typescript \
 && npm prune --omit=dev --ignore-scripts \
 && cp -r /tmp/typescript node_modules/typescript

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils libreoffice-writer-nogui fontconfig \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
ENV RENDITION_SOFFICE=/usr/bin/soffice
WORKDIR /repo
COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /repo/apps/web/dist apps/web/dist
COPY --chown=node:node db/migrations db/migrations
COPY --chown=node:node scripts/migrate.mjs scripts/render-start.mjs scripts/
COPY --chown=node:node package.json package.json
# The gate only: the launcher, the fake AI, the one fake Oracle and its loader.
COPY --chown=node:node e2e/gate e2e/gate
COPY --chown=node:node e2e/fullstack/fake-ai.mjs e2e/fullstack/fake-oracle.mjs e2e/fullstack/
COPY --chown=node:node apps/api/src/testing/fake-oracle.ts apps/api/src/testing/fake-oracle.ts
ENV WEB_DIST_DIR=/repo/apps/web/dist
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/render-start.mjs", "e2e/gate/gate-server.mjs"]
