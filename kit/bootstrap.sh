#!/usr/bin/env bash
# cloudrun-kit · bootstrap — crea en Google Cloud todo lo que un pipeline de Cloud Run + Cloud Build asume
# que existe. IDEMPOTENTE: lo que ya existe se omite. Lo invoca `cloudrun-kit bootstrap <archivo.env>`.
# Formato del archivo de entorno: `cloudrun-kit env new` genera uno comentado (templates/env.example).

set -euo pipefail

DRY_RUN=false; ASSUME_YES=false; ONLY=""; SKIP=""; ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --yes) ASSUME_YES=true ;;
    --only) ONLY="$2"; shift ;;
    --skip) SKIP="$2"; shift ;;
    -*) echo "Opción desconocida: $1" >&2; exit 2 ;;
    *) ENV_FILE="$1" ;;
  esac
  shift
done
[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || { echo "Uso: cloudrun-kit bootstrap <archivo.env> [--dry-run] [--yes] [--only pasos] [--skip pasos]" >&2; exit 2; }

# Valores por defecto de lo opcional (el archivo de entorno los puede sobrescribir).
SECRETS=(); COMPONENTS=(); APIS=()
CLOUDSQL_INSTANCE=""; DB_NAME=""; DB_USER=""; DB_PASSWORD_SECRET="db-password"
GCS_BUCKET=""; GCS_LOCATION="US"; FIREBASE_PROJECT_ID=""
WAKE_SCHEDULE=""; WAKE_COMPONENT=""; WAKE_PATH="/"; TZ_NAME="UTC"
BRANCH="main"; GITHUB_OWNER=""
# Automatización opcional (todo apagado por defecto)
CLOUDSQL_CREATE="no"; CLOUDSQL_TIER="db-f1-micro"; CLOUDSQL_VERSION=""; CLOUDSQL_STORAGE_GB="10"
FIREBASE_ANDROID_PACKAGE=""; FIREBASE_IOS_BUNDLE=""; MOBILE_DIR=""
DNS_PROVIDER="manual"; DNS_ZONE=""; DNS_WAIT_MINUTES="0"
KIT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
CLI_JS="$KIT_DIR/../dist/index.js"

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${APP:?falta APP}" "${ENV_NAME:?falta ENV_NAME}" "${PROJECT_ID:?falta PROJECT_ID}" "${REGION:?falta REGION}"
[ ${#COMPONENTS[@]} -gt 0 ] || { echo "COMPONENTS vacío: define al menos un componente (repo + servicio)" >&2; exit 2; }
SECRET_PREFIX="${SECRET_PREFIX:-$APP}"
AR_REPO="${AR_REPO:-$APP}"
BUILD_SA="${BUILD_SA:-${PROJECT_ID}@appspot.gserviceaccount.com}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
SQL_CONN=""; [ -n "$CLOUDSQL_INSTANCE" ] && SQL_CONN="${PROJECT_ID}:${REGION}:${CLOUDSQL_INSTANCE}"

# ── Utilidades ───────────────────────────────────────────────────────────────────────────────
say()   { printf '%s\n' "$*"; }
ok()    { printf '  ✔ %s\n' "$*"; }
todo()  { printf '  ➜ %s\n' "$*"; }
warn()  { printf '  ⚠ %s\n' "$*"; }
head1() { printf '\n== %s ==\n' "$*"; }
act()   { if $DRY_RUN; then printf '    [dry-run] %s\n' "$*" >&2; else "$@"; fi; }   # ejecuta o solo muestra
gq()    { gcloud "$@" --project "$PROJECT_ID" --quiet; }
secret_name() { printf '%s-%s' "$SECRET_PREFIX" "$1"; }
# Valor de la variable `<componente>_<CLAVE>` (con valor por defecto).
cv() { local n="${1}_${2}"; printf '%s' "${!n:-${3:-}}"; }

# Derivados por componente: SVC_<c> (servicio), JOB_<c> (job de migraciones), SA_<c> (cuenta), URL_<c> (URL determinista).
for c in "${COMPONENTS[@]}"; do
  svc="$(cv "$c" SERVICE "${APP}-${c}-${ENV_NAME}")"
  declare "SVC_${c}=${svc}"
  declare "JOB_${c}=${svc}-migrate"
  declare "SA_${c}=${APP}-$(cv "$c" SA "$c")@${PROJECT_ID}.iam.gserviceaccount.com"
  declare "URL_${c}=https://${svc}-${PROJECT_NUMBER}.${REGION}.run.app"
done

# suffix|VARIABLE|origen (prompt = se pide; b64/hex32 = se genera)
SECRETS_FLAG=""
for d in "${SECRETS[@]}"; do IFS='|' read -r suffix var _ <<<"$d"; SECRETS_FLAG+="${var}=$(secret_name "$suffix"):latest,"; done
SECRETS_FLAG="${SECRETS_FLAG%,}"

want() {
  local s="$1"
  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$s,"*) return 0 ;; *) return 1 ;; esac; fi
  case ",$SKIP," in *",$s,"*) return 1 ;; esac
  [ "$s" = "db-grants" ] && return 1
  return 0
}

instance_exists() { gcloud sql instances describe "$CLOUDSQL_INSTANCE" --project "$PROJECT_ID" >/dev/null 2>&1; }

component_sa()  { local v="SA_$1"; printf '%s' "${!v}"; }
component_svc() { local v="SVC_$1"; printf '%s' "${!v}"; }
component_url() { local v="URL_$1"; printf '%s' "${!v}"; }

# ── Pasos ────────────────────────────────────────────────────────────────────────────────────
step_preflight() {
  head1 "Comprobaciones previas"
  # Valores de relleno de las plantillas (p. ej. los que genera company-cli): desplegar con ellos crearía recursos basura.
  local pending; pending="$(grep -n 'CAMBIAME' "$ENV_FILE" | grep -vE '^[0-9]+:[[:space:]]*#' | cut -c1-120 || true)"
  if [ -n "$pending" ]; then
    if $DRY_RUN; then warn "$ENV_FILE tiene valores sin editar (CAMBIAME); un bootstrap real se negaría a correr:"; printf '%s\n' "$pending" | sed 's/^/      /'
    else echo "$ENV_FILE tiene valores sin editar (CAMBIAME). Edítalos antes de ejecutar:" >&2; printf '%s\n' "$pending" | sed 's/^/  /' >&2; exit 1; fi
  fi
  gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . || { echo "gcloud sin sesión: 'gcloud auth login'" >&2; exit 1; }
  [ -n "$PROJECT_NUMBER" ] || { echo "No existe o no tienes acceso al proyecto $PROJECT_ID" >&2; exit 1; }
  ok "Proyecto $PROJECT_ID (n.º $PROJECT_NUMBER), región $REGION, entorno $ENV_NAME, componentes: ${COMPONENTS[*]}"
  if [ -n "$CLOUDSQL_INSTANCE" ]; then
    if instance_exists; then ok "Instancia Cloud SQL '$CLOUDSQL_INSTANCE' encontrada"
    elif [ "$CLOUDSQL_CREATE" = "yes" ]; then warn "La instancia Cloud SQL '$CLOUDSQL_INSTANCE' no existe: se creará en el paso sql-instance"
    else echo "La instancia Cloud SQL '$CLOUDSQL_INSTANCE' no existe en $PROJECT_ID. Créala, o pon CLOUDSQL_CREATE=yes en $ENV_FILE para que este comando la cree." >&2; exit 1; fi
  fi
  if ! $DRY_RUN && ! $ASSUME_YES; then
    printf '\nSe va a modificar el proyecto "%s". Escribe el id del proyecto para continuar: ' "$PROJECT_ID"
    read -r answer; [ "$answer" = "$PROJECT_ID" ] || { echo "Cancelado."; exit 1; }
  fi
}

step_apis() {
  head1 "1. APIs de Google Cloud"
  local list=(run cloudbuild artifactregistry iam iamcredentials) enabled api
  { [ ${#SECRETS[@]} -gt 0 ] || [ "$CLOUDSQL_CREATE" = "yes" ]; } && list+=(secretmanager)
  [ -n "$FIREBASE_PROJECT_ID" ] && list+=(firebase)
  [ -n "$CLOUDSQL_INSTANCE" ] && list+=(sqladmin)
  [ -n "$GCS_BUCKET" ] && list+=(storage)
  [ -n "$WAKE_SCHEDULE" ] && list+=(cloudscheduler)
  list+=("${APIS[@]}")
  enabled="$(gcloud services list --enabled --project "$PROJECT_ID" --format='value(config.name)')"
  for api in "${list[@]}"; do
    if grep -qx "${api}.googleapis.com" <<<"$enabled"; then ok "$api"; else todo "habilitar $api"; act gq services enable "${api}.googleapis.com"; fi
  done
}

step_registry() {
  head1 "2. Repositorio de imágenes (Artifact Registry)"
  if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$AR_REPO"
  else todo "crear repositorio $AR_REPO"; act gq artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" --description="Imágenes $APP"; fi
}

step_accounts() {
  head1 "3. Cuentas de servicio"
  local c sa
  for c in "${COMPONENTS[@]}"; do
    sa="$(component_sa "$c")"
    if gcloud iam service-accounts describe "$sa" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$sa"
    else todo "crear $sa"; act gq iam service-accounts create "${sa%%@*}" --display-name="${sa%%@*} (runtime)"; fi
  done
}

step_secrets() {
  head1 "4. Secretos (Secret Manager)"
  [ ${#SECRETS[@]} -gt 0 ] || { warn "SECRETS vacío: omitido"; return; }
  local d suffix var origin name val c
  for d in "${SECRETS[@]}"; do
    IFS='|' read -r suffix var origin <<<"$d"; name="$(secret_name "$suffix")"
    if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$name"; continue; fi
    todo "crear secreto $name ($var, $origin)"
    $DRY_RUN && continue
    val="$(printenv "SECRET_VALUE_${var}" || true)"
    if [ -z "$val" ]; then
      case "$origin" in
        b64)   val="$(openssl rand -base64 48 | tr -d '\n')" ;;
        hex32) val="$(openssl rand -hex 32)"; warn "$var no debería cambiarse después (suele cifrar datos)" ;;
        *)     printf '    Valor para %s (no se muestra): ' "$var"; read -rs val; printf '\n' ;;
      esac
    fi
    [ -n "$val" ] || { echo "Valor vacío para $var" >&2; exit 1; }
    printf '%s' "$val" | gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=automatic --data-file=- --quiet >/dev/null
    ok "creado $name"
  done
  for c in "${COMPONENTS[@]}"; do
    [ "$(cv "$c" SECRETS no)" = "yes" ] || continue
    for d in "${SECRETS[@]}"; do
      IFS='|' read -r suffix _ _ <<<"$d"; name="$(secret_name "$suffix")"
      if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1 || ! $DRY_RUN; then
        act gq secrets add-iam-policy-binding "$name" --member="serviceAccount:$(component_sa "$c")" --role=roles/secretmanager.secretAccessor >/dev/null 2>&1 || true
      fi
    done
    if $DRY_RUN; then todo "acceso de $(component_sa "$c") a los secretos existentes (los nuevos lo reciben al crearse)"; else ok "acceso de $(component_sa "$c") a los secretos"; fi
  done
}

step_iam() {
  head1 "5. Permisos (IAM) — lo mínimo para cada cuenta"
  local c sa role
  for c in "${COMPONENTS[@]}"; do
    sa="$(component_sa "$c")"
    for role in $(cv "$c" ROLES); do
      todo "$sa → $role"; act gq projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$sa" --role="$role" --condition=None >/dev/null
    done
    if [ "$(cv "$c" BUCKET no)" = "yes" ]; then
      todo "$sa → firmar URLs de Storage (a sí misma)"; act gq iam service-accounts add-iam-policy-binding "$sa" --member="serviceAccount:$sa" --role=roles/iam.serviceAccountTokenCreator >/dev/null
    fi
    todo "$BUILD_SA → desplegar como $sa"; act gq iam service-accounts add-iam-policy-binding "$sa" --member="serviceAccount:$BUILD_SA" --role=roles/iam.serviceAccountUser >/dev/null
  done
  todo "$BUILD_SA → subir imágenes al repositorio $AR_REPO"; act gq artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" --member="serviceAccount:$BUILD_SA" --role=roles/artifactregistry.writer >/dev/null
}

step_sql_instance() {
  head1 "5b. Instancia de Cloud SQL (opcional)"
  [ -n "$CLOUDSQL_INSTANCE" ] || { warn "CLOUDSQL_INSTANCE vacío: omitido"; return; }
  if instance_exists; then ok "instancia $CLOUDSQL_INSTANCE ya existe"; return; fi
  [ "$CLOUDSQL_CREATE" = "yes" ] || { warn "la instancia no existe y CLOUDSQL_CREATE no es 'yes': omitido"; return; }
  local version="${CLOUDSQL_VERSION:-MYSQL_8_0}" name pw
  name="$(secret_name sql-root-password)"
  todo "crear instancia $CLOUDSQL_INSTANCE ($version, $CLOUDSQL_TIER, ${CLOUDSQL_STORAGE_GB} GB, $REGION): tarda ~10 min y genera COSTO CONTINUO"
  if $DRY_RUN; then
    printf '    [dry-run] gcloud sql instances create %s --database-version=%s --tier=%s --region=%s ... (contraseña root → secreto %s)\n' "$CLOUDSQL_INSTANCE" "$version" "$CLOUDSQL_TIER" "$REGION" "$name" >&2
    return
  fi
  pw="$(openssl rand -base64 24 | tr -d '/+=\n')"
  gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1 \
    || printf '%s' "$pw" | gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=automatic --data-file=- --quiet >/dev/null
  # Si el secreto ya existía, la instancia usa SU valor (así la contraseña root guardada siempre es la real).
  pw="$(gcloud secrets versions access latest --secret="$name" --project "$PROJECT_ID")"
  gq sql instances create "$CLOUDSQL_INSTANCE" --database-version="$version" --tier="$CLOUDSQL_TIER" --region="$REGION" \
    --storage-size="$CLOUDSQL_STORAGE_GB" --storage-auto-increase --edition=ENTERPRISE --availability-type=zonal \
    --backup-start-time=03:00 --root-password="$pw"
  ok "instancia $CLOUDSQL_INSTANCE creada (contraseña root en el secreto $name)"
}

step_sql() {
  head1 "6. Base de datos y usuario (Cloud SQL)"
  [ -n "$CLOUDSQL_INSTANCE" ] && [ -n "$DB_NAME" ] || { warn "CLOUDSQL_INSTANCE/DB_NAME vacíos: omitido"; return; }
  if ! instance_exists; then todo "crear base $DB_NAME y usuario ${DB_USER:-}: cuando exista la instancia"; return; fi
  if gcloud sql databases list --instance "$CLOUDSQL_INSTANCE" --project "$PROJECT_ID" --format='value(name)' | grep -qx "$DB_NAME"; then ok "base $DB_NAME"
  else todo "crear base $DB_NAME"; act gq sql databases create "$DB_NAME" --instance="$CLOUDSQL_INSTANCE" --charset=utf8mb4 --collation=utf8mb4_0900_ai_ci; fi
  [ -n "$DB_USER" ] || return
  if gcloud sql users list --instance "$CLOUDSQL_INSTANCE" --project "$PROJECT_ID" --format='value(name)' | grep -qx "$DB_USER"; then ok "usuario $DB_USER"
  else
    todo "crear usuario $DB_USER (con la contraseña del secreto $(secret_name "$DB_PASSWORD_SECRET"))"
    $DRY_RUN || act gq sql users create "$DB_USER" --instance="$CLOUDSQL_INSTANCE" --host='%' --password="$(gcloud secrets versions access latest --secret="$(secret_name "$DB_PASSWORD_SECRET")" --project "$PROJECT_ID")"
  fi
  warn "Un usuario creado así tiene privilegios amplios en TODA la instancia. Limítalo a su base: cloudrun-kit bootstrap $ENV_FILE --only db-grants"
}

step_db_grants() {
  head1 "6b. Limitar el usuario a su propia base"
  command -v cloud-sql-proxy >/dev/null && command -v mariadb >/dev/null || { warn "Faltan cloud-sql-proxy y/o mariadb"; return; }
  local admin="${CLOUDSQL_ADMIN_USER:-}" pw="${CLOUDSQL_ADMIN_PASSWORD:-}" sql pid
  if [ -z "$pw" ] && gcloud secrets describe "$(secret_name sql-root-password)" --project "$PROJECT_ID" >/dev/null 2>&1; then
    pw="$(gcloud secrets versions access latest --secret="$(secret_name sql-root-password)" --project "$PROJECT_ID")"; admin="${admin:-root}"
  fi
  [ -n "$admin" ] || { printf '    Usuario administrador de la instancia: '; read -r admin; }
  [ -n "$pw" ] || { printf '    Contraseña de %s (no se muestra): ' "$admin"; read -rs pw; printf '\n'; }
  sql="REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${DB_USER}'@'%'; GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%'; FLUSH PRIVILEGES; SHOW GRANTS FOR '${DB_USER}'@'%';"
  if $DRY_RUN; then todo "ejecutaría: $sql"; return; fi
  cloud-sql-proxy --port 3398 "$SQL_CONN" >/dev/null 2>&1 & pid=$!
  sleep 6; MYSQL_PWD="$pw" mariadb -h127.0.0.1 -P3398 -u"$admin" -e "$sql" || warn "No se pudo aplicar"
  kill "$pid" 2>/dev/null || true
}

step_bucket() {
  head1 "7. Bucket de archivos (Cloud Storage) — privado"
  [ -n "$GCS_BUCKET" ] || { warn "GCS_BUCKET vacío: omitido"; return; }
  if gcloud storage buckets describe "gs://$GCS_BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "gs://$GCS_BUCKET"
  else todo "crear gs://$GCS_BUCKET"; act gq storage buckets create "gs://$GCS_BUCKET" --location="$GCS_LOCATION" --uniform-bucket-level-access --public-access-prevention; fi
  local c
  for c in "${COMPONENTS[@]}"; do
    [ "$(cv "$c" BUCKET no)" = "yes" ] || continue
    todo "$(component_sa "$c") → acceso al bucket"; act gq storage buckets add-iam-policy-binding "gs://$GCS_BUCKET" --member="serviceAccount:$(component_sa "$c")" --role=roles/storage.objectAdmin >/dev/null
  done
  todo "bloquear acceso público del bucket"; act gq storage buckets update "gs://$GCS_BUCKET" --public-access-prevention >/dev/null
}

step_firebase() {
  head1 "8. Firebase Cloud Messaging (push)"
  [ -n "$FIREBASE_PROJECT_ID" ] || { warn "FIREBASE_PROJECT_ID vacío: omitido"; return; }
  todo "habilitar la API de FCM en $FIREBASE_PROJECT_ID"; act gcloud services enable fcm.googleapis.com --project "$FIREBASE_PROJECT_ID" --quiet
  local c
  for c in "${COMPONENTS[@]}"; do
    [ "$(cv "$c" FCM no)" = "yes" ] || continue
    todo "$(component_sa "$c") → enviar mensajes en $FIREBASE_PROJECT_ID"
    act gcloud projects add-iam-policy-binding "$FIREBASE_PROJECT_ID" --member="serviceAccount:$(component_sa "$c")" --role=roles/firebasecloudmessaging.admin --condition=None --quiet >/dev/null
  done
  warn "Falta a mano: bajar google-services.json / GoogleService-Info.plist de la consola de Firebase y ponerlos en la app móvil"
}

step_firebase_app() {
  head1 "8b. App de Firebase (Android/iOS) y archivo de configuración"
  if [ -z "$FIREBASE_PROJECT_ID" ] || { [ -z "$FIREBASE_ANDROID_PACKAGE" ] && [ -z "$FIREBASE_IOS_BUNDLE" ]; }; then
    warn "FIREBASE_PROJECT_ID y FIREBASE_ANDROID_PACKAGE / FIREBASE_IOS_BUNDLE vacíos: omitido"; return
  fi
  [ -f "$CLI_JS" ] || { warn "no encuentro $CLI_JS (¿instalación incompleta?)"; return; }
  local hub_root mobile args
  hub_root="$(cd "$(dirname "$ENV_FILE")/.." && pwd)"; mobile="${MOBILE_DIR:-$hub_root/Mobile}"
  args=(firebase-app --project "$FIREBASE_PROJECT_ID")
  [ -n "$FIREBASE_ANDROID_PACKAGE" ] && args+=(--android-package "$FIREBASE_ANDROID_PACKAGE" --android-out "$mobile/android/app/google-services.json")
  [ -n "$FIREBASE_IOS_BUNDLE" ] && args+=(--ios-bundle "$FIREBASE_IOS_BUNDLE" --ios-out "$mobile/ios/Runner/GoogleService-Info.plist")
  $DRY_RUN && args+=(--dry-run)
  node "$CLI_JS" "${args[@]}" || warn "no se pudo preparar la app de Firebase (revisa que tu cuenta administre el proyecto '$FIREBASE_PROJECT_ID')"
}

step_github() {
  head1 "8c. Acceso de la app Google Cloud Build a los repos de GitHub"
  [ -n "$GITHUB_OWNER" ] || { warn "GITHUB_OWNER vacío: omitido"; return; }
  command -v gh >/dev/null 2>&1 || { warn "gh no está instalado: da acceso a mano (GitHub → Settings → Applications → Google Cloud Build → Configure)"; return; }
  gh auth status >/dev/null 2>&1 || { warn "gh sin sesión (gh auth login): da acceso a mano"; return; }
  local inst id selection c repo repos repo_id
  inst="$(gh api "/orgs/${GITHUB_OWNER}/installations" --jq '.installations[] | select(.app_slug=="google-cloud-build") | "\(.id) \(.repository_selection)"' 2>/dev/null || true)"
  if [ -z "$inst" ]; then
    warn "no encontré la app google-cloud-build en '$GITHUB_OWNER' (¿no eres admin de la organización, o no está instalada?). Instálala: https://github.com/apps/google-cloud-build"; return
  fi
  read -r id selection <<<"$inst"
  if [ "$selection" = "all" ]; then ok "la app tiene acceso a TODOS los repos de $GITHUB_OWNER"; return; fi
  repos="$(gh api "/user/installations/${id}/repositories" --paginate --jq '.repositories[].name' 2>/dev/null || true)"
  for c in "${COMPONENTS[@]}"; do
    repo="$(cv "$c" REPO)"; [ -n "$repo" ] || continue
    if grep -qx "$repo" <<<"$repos"; then ok "$repo ya está autorizado"; continue; fi
    todo "conceder a la app acceso a $GITHUB_OWNER/$repo"
    repo_id="$(gh api "repos/${GITHUB_OWNER}/${repo}" --jq .id 2>/dev/null || true)"
    [ -n "$repo_id" ] || { warn "no pude leer el repo $repo (¿existe y tienes acceso?)"; continue; }
    act gh api -X PUT "/user/installations/${id}/repositories/${repo_id}" >/dev/null
  done
}

trigger_exists() { gcloud builds triggers describe "$1" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; }

# Crea el trigger; si falla por falta de acceso del repo a la app de Cloud Build, intenta concederlo y reintenta una vez.
create_trigger() {
  local name="$1" repo="$2" c="$3" ignored="$4" subs="$5"
  local -a cmd=(gcloud builds triggers create github --project "$PROJECT_ID" --quiet --region="$REGION" --name="$name" --repo-owner="$GITHUB_OWNER" --repo-name="$repo"
    --branch-pattern="^${BRANCH}\$" --build-config="$(cv "$c" BUILD_CONFIG cloudbuild.yaml)" --ignored-files="$ignored"
    --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}")
  [ -n "$subs" ] && cmd+=(--substitutions="$subs")
  if $DRY_RUN; then printf '    [dry-run] %s\n' "${cmd[*]}" >&2; return 0; fi
  local out
  if out="$("${cmd[@]}" 2>&1)"; then ok "trigger $name creado"; return 0; fi
  if grep -q "Repository mapping does not exist" <<<"$out"; then
    warn "la app de Cloud Build no tiene acceso a $GITHUB_OWNER/$repo: intento concederlo automáticamente"
    step_github
    if out="$("${cmd[@]}" 2>&1)"; then ok "trigger $name creado"; return 0; fi
  fi
  printf '%s\n' "$out" >&2; exit 1
}

step_triggers() {
  head1 "9. Triggers de Cloud Build (push a $BRANCH → despliegue)"
  [ -n "$GITHUB_OWNER" ] || { warn "GITHUB_OWNER vacío: omitido"; return; }
  local c name repo subs ignored
  for c in "${COMPONENTS[@]}"; do
    name="$(component_svc "$c")-deploy"; repo="$(cv "$c" REPO)"; ignored="$(cv "$c" IGNORED '**/*.md')"
    [ -n "$repo" ] || { warn "${c}_REPO vacío: sin trigger para $c"; continue; }
    subs="$(eval "printf '%s' \"$(cv "$c" SUBS)\"")"
    if trigger_exists "$name"; then ok "$name (ya existe; para cambiarlo: 'gcloud builds triggers delete' y volver a correr)"; continue; fi
    todo "crear $name ($GITHUB_OWNER/$repo)"
    create_trigger "$name" "$repo" "$c" "$ignored" "$subs"
  done
}

wait_build() {
  local id="$1" i status
  for i in $(seq 1 150); do
    status="$(gcloud builds describe "$id" --region "$REGION" --project "$PROJECT_ID" --format='value(status)')"
    case "$status" in SUCCESS) ok "build $id terminado"; return 0 ;; FAILURE|CANCELLED|TIMEOUT|INTERNAL_ERROR|EXPIRED) echo "  ✖ build $id: $status" >&2; return 1 ;; esac
    sleep 10
  done
  echo "  ✖ build $id: tiempo de espera agotado" >&2; return 1
}

step_build() {
  head1 "10. Primer despliegue (en el orden de COMPONENTS)"
  local c svc trigger id
  for c in "${COMPONENTS[@]}"; do
    svc="$(component_svc "$c")"; trigger="${svc}-deploy"
    if gcloud run services describe "$svc" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$svc ya desplegado (se actualiza con push a $BRANCH)"; continue; fi
    todo "primer despliegue de $svc con el trigger $trigger"
    if $DRY_RUN; then printf '    [dry-run] gcloud builds triggers run %s --branch=%s\n' "$trigger" "$BRANCH" >&2; continue; fi
    id="$(gcloud builds triggers run "$trigger" --region "$REGION" --project "$PROJECT_ID" --branch="$BRANCH" --format='value(metadata.build.id)')"
    wait_build "$id"
  done
}

step_domains() {
  head1 "11. Dominios"
  local c domain svc any=false
  for c in "${COMPONENTS[@]}"; do
    domain="$(cv "$c" DOMAIN)"; [ -n "$domain" ] || continue; any=true; svc="$(component_svc "$c")"
    if gcloud beta run domain-mappings describe --domain "$domain" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$domain → $svc"
    else todo "mapear $domain → $svc"; act gcloud beta run domain-mappings create --service "$svc" --domain "$domain" --region "$REGION" --project "$PROJECT_ID" --quiet; fi
  done
  $any || warn "Sin dominios definidos: omitido"
}

# Registros DNS que Cloud Run pide para un dominio (tipo|nombre|valor por línea); por defecto un CNAME a ghs.googlehosted.com.
domain_records() {
  local out
  out="$(gcloud beta run domain-mappings describe --domain "$1" --region "$REGION" --project "$PROJECT_ID" --flatten='status.resourceRecords[]' \
    --format='csv[no-heading](status.resourceRecords.type,status.resourceRecords.name,status.resourceRecords.rrdata)' 2>/dev/null || true)"
  [ -n "$out" ] && printf '%s\n' "$out" | tr ',' '|' || printf 'CNAME|%s|ghs.googlehosted.com.\n' "${1%%.*}"
}

dns_resolves() {  # ¿el dominio ya apunta a Google? (variable, no `| grep -q`: con pipefail el cierre temprano del pipe da falso negativo)
  local answer
  answer="$(dig +short CNAME "$1" 2>/dev/null; getent hosts "$1" 2>/dev/null)" || true
  [[ "${answer,,}" == *ghs.googlehosted.com* ]]
}

step_dns() {
  head1 "11b. DNS de los dominios"
  local c domain any=false relative pending=()
  for c in "${COMPONENTS[@]}"; do
    domain="$(cv "$c" DOMAIN)"; [ -n "$domain" ] || continue; any=true
    if dns_resolves "$domain"; then ok "$domain ya apunta a Google"; continue; fi
    pending+=("$domain")
    todo "$domain todavía no resuelve a Google. Crea en tu DNS (${DNS_PROVIDER}):"
    relative="$domain"; [ -n "$DNS_ZONE" ] && relative="${domain%.$DNS_ZONE}"
    while IFS='|' read -r rtype rname rvalue; do
      [ -n "$rtype" ] || continue
      printf '        Tipo %-6s Host %-28s Valor %s\n' "$rtype" "$( [ "$rtype" = CNAME ] && printf '%s' "$relative" || printf '%s' "${rname:-@}")" "$rvalue"
    done < <(domain_records "$domain")
  done
  $any || { warn "Sin dominios definidos: omitido"; return; }
  if [ ${#pending[@]} -gt 0 ]; then
    case "$DNS_PROVIDER" in
      squarespace) warn "Squarespace no tiene API de DNS: Domains → tu dominio → DNS → DNS Settings → Add Record (Custom Records)." ;;
      *) warn "Este proveedor de DNS no se automatiza: crea los registros de arriba a mano." ;;
    esac
    if ! $DRY_RUN && [ "${DNS_WAIT_MINUTES:-0}" -gt 0 ]; then
      printf '    Esperando la propagación (hasta %s min)...\n' "$DNS_WAIT_MINUTES"
      local i left
      for i in $(seq 1 $(( DNS_WAIT_MINUTES * 2 ))); do
        left=(); for domain in "${pending[@]}"; do dns_resolves "$domain" || left+=("$domain"); done
        pending=("${left[@]}"); [ ${#pending[@]} -eq 0 ] && break; sleep 30
      done
      [ ${#pending[@]} -eq 0 ] && ok "todos los dominios resuelven" || warn "sin propagar todavía: ${pending[*]} (vuelve a correr: company-cli bootstrap $ENV_FILE --only dns)"
    fi
  fi
  for c in "${COMPONENTS[@]}"; do
    domain="$(cv "$c" DOMAIN)"; [ -n "$domain" ] || continue
    local ready; ready="$(gcloud beta run domain-mappings describe --domain "$domain" --region "$REGION" --project "$PROJECT_ID" --format='value(status.conditions[0].status)' 2>/dev/null || true)"
    case "$ready" in True) ok "$domain: certificado listo" ;; "") : ;; *) warn "$domain: certificado aún en emisión (Google lo emite solo cuando el DNS ya apunta a él)" ;; esac
  done
}

step_scheduler() {
  head1 "12. Despertador (solo si el servicio escala a cero)"
  [ -n "$WAKE_SCHEDULE" ] && [ -n "$WAKE_COMPONENT" ] || { warn "WAKE_SCHEDULE/WAKE_COMPONENT vacíos: omitido"; return; }
  local name="$(component_svc "$WAKE_COMPONENT")-wake"
  if gcloud scheduler jobs describe "$name" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then ok "$name"
  else todo "crear $name ($WAKE_SCHEDULE, $TZ_NAME)"
    act gq scheduler jobs create http "$name" --location="$REGION" --schedule="$WAKE_SCHEDULE" --time-zone="$TZ_NAME" \
      --uri="$(component_url "$WAKE_COMPONENT")${WAKE_PATH}" --http-method=GET --attempt-deadline=60s; fi
}

step_verify() {
  head1 "13. Verificación"
  local c path
  for c in "${COMPONENTS[@]}"; do
    path="$(cv "$c" HEALTH)"; [ -n "$path" ] || continue
    local out code body
    out="$(curl -s -m 30 -w '\n%{http_code}' "$(component_url "$c")${path}" 2>/dev/null || true)"
    code="${out##*$'\n'}"; body="${out%$'\n'*}"
    printf '  %s%s: HTTP %s  %s\n' "$c" "$path" "${code:-sin respuesta}" "$(printf '%s' "$body" | head -c 70 | tr -d '\n')"
  done
}

# ── Ejecución ────────────────────────────────────────────────────────────────────────────────
$DRY_RUN && say "MODO DRY-RUN: no se modifica nada."
step_preflight
for s in apis registry accounts secrets iam sql-instance sql bucket firebase firebase-app github triggers build domains dns scheduler verify db-grants; do
  want "$s" && "step_${s//-/_}"
done
say; $DRY_RUN && say "Dry-run terminado: revisa los '➜' (lo que se crearía)." || say "Listo."
