FROM node:24-bookworm-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/importer/package.json packages/importer/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/importer/package.json packages/importer/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/web/dist ./apps/web/dist
COPY --from=build /workspace/apps/api/src/bootstrap-admin.ts ./apps/api/src/bootstrap-admin.ts
COPY --from=build /workspace/apps/api/src/import-legacy.ts ./apps/api/src/import-legacy.ts
COPY --from=build /workspace/packages/db/src/migrate.ts ./packages/db/src/migrate.ts
COPY --from=build /workspace/packages/db/migrations ./packages/db/migrations
COPY --from=build /workspace/packages/importer/src ./packages/importer/src
COPY --from=build /workspace/packages/importer/package.json ./packages/importer/package.json

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
