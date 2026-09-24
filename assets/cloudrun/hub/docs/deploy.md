# Despliegue — __PROJECT_NAME__ (Google Cloud Run + Cloud Build)

Este Hub ya viene listo para desplegarse. Todo se hace con **`cloudrun-kit`** (CLI global, fuera de este repo):
`cloudrun-kit guide` muestra la guía completa paso a paso.

## Qué trae cada repo

| Repo | Archivos de despliegue |
|---|---|
| `Back/` (API NestJS) | `Dockerfile` (producción no root, `PORT` 8080), `docker-entrypoint.sh` (migraciones), `.dockerignore`, `cloudbuild.yaml`, `GET /__API_PREFIX__/health` (+ `/health/db`, `/health/redis`), `GET /__API_PREFIX__/client-config` |
| `Front/` (__FRONT_FRAMEWORK__) | `Dockerfile` (producción no root, 8080), `.dockerignore`, `cloudbuild.yaml` |
| `Mobile/` (Flutter) | `lib/core/config/env.dart` (URL del Back por `--dart-define`), `client_config.dart`, `README.md` (push con Firebase) |
| Este repo | `deploy/staging.env` (definición del entorno, sin secretos) |

## Primer despliegue

1. **Edita `deploy/staging.env`** (todo lo que diga `CAMBIAME`: proyecto de GCP, Redis, Pusher, instancia de Cloud SQL).
2. **Sube los repos a GitHub**, rama `staging`, y da acceso a los repos a la app *Google Cloud Build* (una vez por organización).
3. `cloudrun-kit bootstrap deploy/staging.env --dry-run` → revisa qué existe y qué se crearía (no modifica nada).
4. `cloudrun-kit bootstrap deploy/staging.env` → crea APIs, repositorio de imágenes, cuentas de servicio, secretos, permisos,
   base de datos, triggers, primer despliegue y dominios. Es **idempotente**: repetirlo es seguro.
5. Configura el DNS de los dominios (`CNAME` → `ghs.googlehosted.com.`).
6. Desde ahí, **cada `git push` a `staging` despliega solo**: el Back corre las migraciones antes de desplegar.

## Lo que hay que saber

- **Migraciones:** el servicio se despliega con `RUN_MIGRATIONS=false`; un Cloud Run Job las aplica una sola vez (`MIGRATE_ONLY=true`).
- **Secretos** (contraseña de la base, JWT, MFA, Pusher, Redis) van en Secret Manager, no en variables de entorno.
- **`MFA_ENCRYPTION_KEY` no se puede cambiar** después de que alguien active MFA; cambiar los `JWT_*` cierra todas las sesiones.
- **Documentación de la API** (`/reference`): solo fuera de producción; `ENABLE_API_DOCS=true` para habilitarla.
- **Front:** las variables públicas del cliente se **incrustan al compilar** (`--build-arg` en `cloudbuild.yaml`); cambiarlas exige reconstruir.
- **App móvil:** compílala con `--dart-define=API_URL=https://<api>`; el push con Firebase está en `Mobile/README.md`.
