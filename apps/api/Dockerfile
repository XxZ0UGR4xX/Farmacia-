# syntax=docker/dockerfile:1
# Construir desde la raíz del repositorio:  docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @farmacia/api --include-workspace-root=false

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
# prisma generate no se conecta a la base: la URL sólo debe existir
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npx tsup

FROM deps AS prod-deps
RUN npm prune --omit=dev --workspace @farmacia/api --include-workspace-root=false

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api

# Nunca correr como root
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Aplica migraciones pendientes (no destructivo) y arranca la API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
