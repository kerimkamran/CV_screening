# PLAT-04: API image. Build context = repository root.  docker build -f docker/api.Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared && npm run build -w apps/api \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /repo
# pdftotext reads PDF CVs.
RUN apk add --no-cache poppler-utils
# Non-root; no shell tooling beyond the base image; no secrets baked in (PLAT-05).
USER node
COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
EXPOSE 3000
# Liveness only: readiness is for the orchestrator's traffic routing (PLAT-07).
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
