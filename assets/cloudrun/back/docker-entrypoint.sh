#!/bin/sh
# Entrypoint de la API.
#  - Desarrollo: aplica las migraciones al arrancar (`npm run migration:run`, si el proyecto lo define).
#  - Producción: por defecto también (`docker run` local); en Cloud Run el SERVICIO se despliega con
#    RUN_MIGRATIONS=false y las migraciones corren UNA vez en un Cloud Run Job con MIGRATE_ONLY=true. Migrar desde
#    cada instancia significa que N instancias en frío compiten por la misma migración y que cada arranque paga su tiempo.
set -e

if [ "$NODE_ENV" = "production" ]; then
  if [ "$RUN_MIGRATIONS" != "false" ]; then
    npm run --if-present migration:run:prod
  fi
else
  npm run --if-present migration:run
fi

# Modo Job: aplicar migraciones y terminar sin levantar el servidor.
if [ "$MIGRATE_ONLY" = "true" ]; then
  exit 0
fi

exec "$@"
