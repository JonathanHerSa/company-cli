# Dockerfile de __PROJECT_NAME__ (API NestJS) listo para Cloud Run. `docker build .` construye el último stage
# (production), que es el que despliega Cloud Build; `target: development` es el que usa compose.dev.yml.
ARG NODE_TAG=__NODE_TAG__

FROM node:${NODE_TAG} AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start:dev"]

FROM node:${NODE_TAG} AS builder
WORKDIR /app
COPY package*.json ./
# --force: el package-lock.json generado en el host (macOS/Linux) puede listar `fsevents` (solo macOS) sin marcarlo como opcional
# y `npm ci` lo rechaza en la imagen Linux (EBADPLATFORM). --force omite esa validación de plataforma.
RUN npm ci --force
COPY . .
RUN npm run build

# Solo dependencias de producción, en su propio stage: la capa se reutiliza mientras package*.json no cambie.
FROM node:${NODE_TAG} AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --force && npm cache clean --force

FROM node:${NODE_TAG} AS production
ENV NODE_ENV=production
# Cloud Run inyecta PORT (8080); este valor solo aplica al correr la imagen fuera de él.
ENV PORT=8080
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
# No correr como root: un fallo en la app no debe dar control del contenedor.
USER node
EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
