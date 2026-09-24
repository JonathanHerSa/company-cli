# Dockerfile de __PROJECT_NAME__ (Front, __FRONT_FRAMEWORK__) listo para Cloud Run. `docker build .` construye el último
# stage (production); `target: development` es el que usa compose.dev.yml.
ARG NODE_TAG=__NODE_TAG__
# @if vue
ARG NGINX_TAG=__NGINX_TAG__
# @endif

FROM node:${NODE_TAG} AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:${NODE_TAG} AS builder
WORKDIR /app
COPY package*.json ./
# --force: el package-lock.json generado en el host (macOS/Linux) puede listar `fsevents` (solo macOS) sin marcarlo como opcional
# y `npm ci` lo rechaza en la imagen Linux (EBADPLATFORM). --force omite esa validación de plataforma.
RUN npm ci --force
COPY . .
# @if next
# Las NEXT_PUBLIC_* se INCRUSTAN en el bundle en `next build`: definirlas al ejecutar el contenedor ya no sirve. Van como
# --build-arg (ver cloudbuild.yaml); sin ellas la imagen sale con Pusher, mapas y URL pública vacíos.
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_PUSHER_KEY=
ARG NEXT_PUBLIC_PUSHER_CLUSTER=us2
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY \
    NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_TELEMETRY_DISABLED=1
# @else
# Las VITE_* se incrustan en el bundle al compilar: van como --build-arg (ver cloudbuild.yaml).
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# @endif
RUN npm run build

# @if next
# `output: "standalone"` (next.config.ts): servidor Node mínimo, sin necesitar `node_modules` completo en la imagen final.
FROM node:${NODE_TAG} AS production
WORKDIR /app
# HOSTNAME=0.0.0.0 es obligatorio en Cloud Run: dentro del contenedor HOSTNAME trae el id del contenedor y Next escucharía
# solo en esa interfaz, no en la que Cloud Run consulta (el servicio arranca pero el health check nunca pasa).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
CMD ["node", "server.js"]
# @else
# nginx sin privilegios (usuario no root, puerto 8080): sirve el build estático de Vue con fallback SPA.
FROM nginxinc/nginx-unprivileged:${NGINX_TAG} AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
# @endif
