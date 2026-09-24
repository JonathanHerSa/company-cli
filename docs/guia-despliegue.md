# Guía de despliegue en Google Cloud (Cloud Run + Cloud Build)

El despliegue es parte de **`company-cli`** (el mismo paquete que crea los Hubs; también se invoca como `cloudrun-kit`, es el mismo binario).
Prepara un repo para Cloud Run y crea, **de una vez**, todo lo que el pipeline necesita en Google Cloud, para cualquier repo y
cualquier entorno (staging, producción, otro cliente).
Esta guía explica **qué necesita una app para funcionar en la nube, por qué, y cómo crearlo**. Los ejemplos vienen de FTS.

> Resumen, en cualquier repo:
>
> ```bash
> company-cli init                                   # Dockerfile + .dockerignore + cloudbuild.yaml del repo
> company-cli env new staging                        # deploy/staging.env: define el entorno (edítalo)
> company-cli bootstrap deploy/staging.env --dry-run    # mira qué haría, sin tocar nada
> company-cli bootstrap deploy/staging.env              # lo crea todo en Google Cloud
> ```

---

## 1. El mapa completo: quién habla con quién

```
                 ┌────────────── GitHub (rama staging) ──────────────┐
                 │  fts_back (API)            fts_front (portal web) │
                 └──────────┬──────────────────────────┬─────────────┘
                            │ git push                 │ git push
                            ▼                          ▼
                    ┌──────────────────  Cloud Build  ──────────────────┐
                    │ (1) construye la imagen con el Dockerfile          │
                    │ (2) la sube a Artifact Registry                    │
                    │ (3) API: corre las migraciones (Cloud Run Job)     │
                    │ (4) despliega en Cloud Run                         │
                    └──────────┬──────────────────────────┬─────────────┘
                               ▼                          ▼
                      ┌────────────────┐  HTTPS   ┌────────────────┐
   App móvil ────────►│  API (Back)    │◄─────────│ Portal (Front) │◄──── Navegador
                      │  Cloud Run     │   (BFF)  │  Cloud Run     │
                      └───┬───┬───┬───┬┘          └────────────────┘
                          │   │   │   └──► Firebase (push al celular)
                          │   │   └──────► Cloud Storage (fotos de evidencias, privado)
                          │   └──────────► Redis Cloud (colas y sesiones)
                          └──────────────► Cloud SQL (MySQL: los datos)
                     Secret Manager: las contraseñas y llaves que la API lee al arrancar
```

Dos ideas que lo explican casi todo:

1. **Cloud Run solo corre el contenedor.** Todo lo que el contenedor necesita (base de datos, contraseñas,
   tablas, almacenamiento) tiene que **existir antes** de desplegar. Por eso "crear el contenedor directo"
   funciona con apps simples (sin base ni secretos) y con FTS no.
2. **El Dockerfile y Cloud Build no compiten.** El Dockerfile es la *receta de la imagen*; Cloud Build es
   quien la ejecuta y hace lo demás (migraciones, despliegue). Ver la sección 6.

## 2. Glosario (lo mínimo para entender el resto)

| Término | Qué es, en una frase |
|---|---|
| **Imagen** | La app ya empaquetada (código + Node + dependencias). Se construye con el `Dockerfile`. |
| **Contenedor** | La imagen corriendo. Cloud Run arranca contenedores cuando llegan peticiones. |
| **Cloud Run** | Servicio de Google que corre contenedores y escala solo (incluso a cero). |
| **Cloud Build** | El "robot" que ejecuta el pipeline: construir, subir, migrar, desplegar. |
| **Trigger** | Regla de Cloud Build: "cuando alguien haga push a la rama X del repo Y, ejecuta este pipeline". |
| **Artifact Registry** | El almacén donde se guardan las imágenes construidas. |
| **Migración** | Un archivo que dice qué cambio hacerle a la base (crear tabla, añadir columna). Cada una corre una vez. |
| **Secreto** | Una contraseña o llave guardada cifrada en Secret Manager. |
| **Cuenta de servicio** | La "identidad" con la que corre un servicio o job; lo que puede hacer se le da con roles. |
| **Rol (IAM)** | Un permiso concreto (p. ej. "conectarse a Cloud SQL"). Se da lo mínimo necesario. |
| **URL firmada** | Enlace temporal (minutos) a un archivo privado de Storage. Evita hacer público el bucket. |
| **Escala a cero** | `min-instances=0`: sin tráfico no hay instancia corriendo (y no se paga). |

## 3. Qué crea el script, paso a paso

`cloudrun-kit bootstrap` recibe un archivo de entorno (sección 4) y ejecuta estos pasos **en orden**. Cada uno
primero comprueba si ya existe: **repetirlo es seguro**. Con `--dry-run` solo muestra lo que haría.

| # | Paso | Por qué hace falta | Equivalente en la consola web |
|---|---|---|---|
| 1 | APIs | Google exige activar cada servicio antes de usarlo. | *APIs y servicios → Habilitar* |
| 2 | Repositorio de imágenes | Cloud Build necesita dónde guardar la imagen. | *Artifact Registry → Crear repositorio* (Docker, misma región) |
| 3 | Cuentas de servicio | Que cada servicio tenga identidad propia y **no** la cuenta compartida del proyecto. | *IAM → Cuentas de servicio → Crear* |
| 4 | Secretos | Contraseñas y llaves que no deben estar en texto plano. | *Secret Manager → Crear secreto* |
| 5 | Permisos (IAM) | Cada cuenta recibe solo lo que necesita (sección 5). | *IAM → Otorgar acceso* |
| 5b | **Instancia de Cloud SQL** (opcional) | Si no existe y `CLOUDSQL_CREATE=yes`, la crea (~10 min, **costo continuo**) y guarda la contraseña root como secreto. | *Cloud SQL → Crear instancia* |
| 6 | Base y usuario | La API necesita su base y su usuario en Cloud SQL. | *Cloud SQL → Bases de datos / Usuarios* |
| 7 | Bucket | Guardar archivos (evidencias), **privado**. | *Cloud Storage → Crear bucket* |
| 8 | Firebase (permisos) | Permitir que la API mande notificaciones push. | *Firebase → Cloud Messaging* + IAM |
| 8b | **App de Firebase** (opcional) | Crea (o reutiliza) la app Android/iOS y **descarga `google-services.json`** / `GoogleService-Info.plist` a `Mobile/`. Habilita Firebase en el proyecto si hace falta. | *Firebase → Agregar app* + descargar el archivo |
| 8c | **Acceso de GitHub** | Da a la app *Google Cloud Build* acceso a los repos (con `gh`, si eres admin de la organización). Si la app ya ve todos los repos, no hace nada. El paso 9 lo invoca solo si un trigger falla por este motivo. | *GitHub → Settings → Applications → Google Cloud Build → Configure* |
| 9 | Triggers | Que un `git push` despliegue solo. | *Cloud Build → Activadores* |
| 10 | Primer despliegue | Crea los servicios en Cloud Run (en el orden de `COMPONENTS`). | El trigger corre solo |
| 11 | Dominios | Mapea `staging.fts.…` y `staging.api.fts.…` a los servicios. | *Cloud Run → Administrar dominios personalizados* |
| 11b | **DNS** | Muestra el registro **exacto** (tipo, host, valor), comprueba si ya resuelve y, con `DNS_WAIT_MINUTES`, espera la propagación. No crea el registro (ver más abajo). | En tu proveedor de DNS |
| 12 | Despertador | Con `min-instances=0`, despierta la API para los jobs diarios (sección 7). | *Cloud Scheduler → Crear trabajo* |
| 13 | Verificación | Prueba las rutas de salud (`HEALTH`) de cada componente. | — |

Opciones: `--yes` (sin confirmación), `--only secrets,sql` (solo esos pasos), `--skip domains` (omitir).

### Lo que queda manual (y por qué)

- **Registro DNS.** Squarespace Domains (el antiguo Google Domains), GoDaddy y la mayoría de registradores **no tienen API de DNS**, así que
  el script no puede crear el `CNAME` (`host` → `ghs.googlehosted.com.`). El paso `dns` te dice el registro exacto, comprueba si ya resuelve y, con
  `DNS_WAIT_MINUTES=10`, espera la propagación. En Squarespace: *Domains → tu dominio → DNS → DNS Settings → Add Record → Custom Records*.
  (Con Cloud DNS o Cloudflare sí sería automatizable por API.) Google emite el certificado solo cuando el DNS ya apunta a él.
- **iOS.** La llave APNs (`.p8`) requiere tu cuenta de Apple y no hay API pública para subirla a Firebase; las capabilities *Push Notifications* y
  *Background Modes* se activan en Xcode (requiere un Mac).
- **App de Pusher.** Se crea desde su panel (no hay API pública para crear apps).
- **Base de Redis Cloud.** Se crea desde su panel (su API necesita una API key de la cuenta; no está automatizada).
- **Permisos de administrador.** `firebase-app`, `github` y `sql-instance` usan **tu** sesión: necesitas poder administrar Firebase en el proyecto,
  ser admin de la organización de GitHub y crear instancias de Cloud SQL.

## 4. El archivo de entorno (`deploy/<entorno>.env`)

Es la **definición completa** de un entorno y no lleva secretos. `cloudrun-kit env new <entorno>` genera uno comentado.
Es un archivo de shell (comentarios y variables permitidos). Se organiza así:

**Identidad**

| Variable | Qué es |
|---|---|
| `APP`, `ENV_NAME` | Prefijo y entorno; forman los nombres (`fts-back-staging`). |
| `PROJECT_ID`, `REGION` | Proyecto y región de Google Cloud. Idealmente **un proyecto por entorno**. |
| `SECRET_PREFIX`, `AR_REPO` | Prefijo de secretos y repositorio de imágenes (por defecto = `APP`). Si dos entornos comparten proyecto, `SECRET_PREFIX` debe diferir. |
| `GITHUB_OWNER`, `BRANCH`, `BUILD_SA` | Dueño de los repos, rama que despliega y cuenta que ejecuta los builds. |

**Componentes** — cada uno es *un repo + un servicio de Cloud Run*. Se listan en `COMPONENTS=(back front)` y se configuran con
variables `<componente>_<CLAVE>`:

| Clave | Qué hace |
|---|---|
| `_REPO` | Repo de GitHub del componente. |
| `_SA` | Sufijo de su cuenta de servicio: `<APP>-<SA>@<proyecto>` (por defecto, el nombre del componente). |
| `_DOMAIN`, `_HEALTH` | Dominio propio (vacío = no mapear) y ruta que `verify` comprueba. |
| `_SECRETS=yes` | Su cuenta puede leer los secretos de `SECRETS`. |
| `_ROLES` | Roles de proyecto que necesita (p. ej. `roles/cloudsql.client`). |
| `_BUCKET=yes`, `_FCM=yes` | Acceso al bucket (y firma de URLs) / permiso para enviar push. |
| `_IGNORED` | Archivos que **no** disparan el build (por defecto `**/*.md`). |
| `_SUBS` | Sustituciones del `cloudbuild.yaml` del repo, separadas por `\|` (con `^\|^` inicial). Aquí va **todo lo específico del entorno**. |

En `_SUBS` puedes usar `${REGION}`, `${AR_REPO}`, `${PROJECT_ID}`, `${SQL_CONN}`, `${SECRETS_FLAG}` y, por componente,
`${SVC_<c>}` (servicio), `${JOB_<c>}` (job de migraciones), `${SA_<c>}` (cuenta) y `${URL_<c>}` (URL de Cloud Run; por ejemplo
el portal recibe `_INTERNAL_API_URL=${URL_back}`).

**Secretos** — `SECRETS=("sufijo|VARIABLE|origen" ...)`: `prompt` se pide (escritura oculta), `b64` / `hex32` se generan al azar.
Se guardan como `<SECRET_PREFIX>-<sufijo>`. Para automatizar sin preguntas: `SECRET_VALUE_DB_PASSWORD=... cloudrun-kit bootstrap ...`.

**Recursos opcionales** (vacío = se omiten): `CLOUDSQL_INSTANCE` + `DB_NAME` + `DB_USER`, `GCS_BUCKET` (+ `GCS_LOCATION`),
`FIREBASE_PROJECT_ID`, y el despertador `WAKE_SCHEDULE` + `WAKE_COMPONENT` + `WAKE_PATH` + `TZ_NAME`.

**Automatización opcional** (todo apagado por defecto):

| Variable | Qué activa |
|---|---|
| `CLOUDSQL_CREATE=yes` (+ `CLOUDSQL_TIER`, `CLOUDSQL_VERSION`, `CLOUDSQL_STORAGE_GB`) | Crea la instancia de Cloud SQL si no existe (paso 5b). Cuesta dinero y tarda ~10 min; ni el `--dry-run` la crea. |
| `FIREBASE_ANDROID_PACKAGE`, `FIREBASE_IOS_BUNDLE`, `MOBILE_DIR` | Crea/reutiliza la app en Firebase y descarga la configuración a `<Hub>/Mobile` (paso 8b). Requiere `FIREBASE_PROJECT_ID`. |
| `DNS_PROVIDER` (`squarespace`\|`manual`), `DNS_ZONE`, `DNS_WAIT_MINUTES` | Personaliza el paso `dns`: instrucciones por proveedor, host relativo a la zona y espera de propagación. |

Ejemplo real completo: el `deploy/staging.env` del repo raíz de FTS.

## 5. Las piezas, explicadas

### 5.1 Redis Cloud: cómo partir la URL

```
redis://  default  :  CONTRASEÑA  @  HOST  :  PUERTO
protocolo  usuario    contraseña     servidor   puerto
```

- Lo que va **entre `:` y `@`** es la contraseña; **entre `@` y el último `:`**, el host; **al final**, el puerto.
- Se convierte en `REDIS_HOST`, `REDIS_PORT` (en el `.env` del entorno) y `REDIS_PASSWORD` (secreto).
- El usuario `default` no se configura: el código lo usa por defecto.
- Si la contraseña tiene símbolos raros, en la URL van escapados (`%40` = `@`), pero en la variable va el valor real.
- **La app no soporta TLS** para Redis: la base de Redis Cloud debe estar **sin TLS** (URL `redis://`, no `rediss://`).
- `REDIS_PREFIX` evita que dos entornos que comparten la misma base de Redis pisen sus claves (`stg:`, `prod:`).

### 5.2 Cloud SQL: base, usuario y permisos

- **Una instancia, varias bases.** La instancia (`coorsamexico`) es compartida; cada app tiene su base y su usuario.
- **Cómo se conecta Cloud Run:** por el *conector integrado* (`--add-cloudsql-instances`), que expone un socket
  `/cloudsql/<proyecto>:<región>:<instancia>`. No hace falta abrir IPs. La app lo lee de `DB_SOCKET_PATH`.
  (`DB_HOST=localhost` solo cumple la validación; no se usa.)
- **Crear el usuario** con "Autenticación integrada" (como en tu captura) está bien, con un matiz importante:
  esa pantalla marca por defecto el rol **`cloudsqlsuperuser`**, que da **privilegios globales sobre toda la instancia**.
  Verificado en staging: `fts_db_staging` ve las 73 bases de la instancia.
- **Lo correcto:** limitar al usuario a **su** base. El script incluye el paso opcional:

  ```bash
  cloudrun-kit bootstrap deploy/staging.env --only db-grants   # pide un usuario administrador de la instancia
  ```

  que ejecuta:

  ```sql
  REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'fts_db_staging'@'%';
  GRANT ALL PRIVILEGES ON `fts_db_staging`.* TO 'fts_db_staging'@'%';
  FLUSH PRIVILEGES;
  ```

  (Hazlo cuando ninguna otra app dependa de que ese usuario tenga permisos globales; no debería.)
- **La contraseña** que genera la consola se ve en pantalla: no reutilices una que hayas mostrado o capturado.

### 5.3 Secret Manager en lugar de variables

| | Variable de entorno | Secret Manager |
|---|---|---|
| Quién la ve | Cualquiera con acceso de lectura al servicio | Solo las cuentas con `secretAccessor` |
| Cifrado / historial | Texto plano, sin versiones | Cifrado, con versiones |
| Auditoría | No | Registra quién la leyó |
| Cambiar el valor | Editar el servicio | Nueva versión, sin tocar el servicio |
| Cambios en el código | — | **Ninguno**: llega como variable de entorno igual |

En la consola de Cloud Run, pestaña *Variables y secretos*, junto a "Agregar variable" está **"Hacer referencia a un
secreto"**. Regla práctica: lo que da acceso (contraseñas, JWT, llaves) va a Secret Manager; lo que solo describe
(host, puerto, región, nombre de la base) va como variable normal.

Secretos de FTS: `db-password`, `jwt-secret`, `jwt-refresh-secret`, `mfa-encryption-key`, `pusher-secret`,
`redis-password`, `bootstrap-admin-password` (y `smtp-password` si hay correo).

> **`MFA_ENCRYPTION_KEY` no se puede cambiar después:** cifra los secretos de MFA guardados. Si cambia, quienes ya
> activaron MFA quedan bloqueados. Cambiar los `JWT_*` cierra todas las sesiones activas.

### 5.4 Migraciones

- Una migración es un archivo TypeScript que aplica **un cambio** a la base (`CREATE TABLE …`). Corren **en orden**,
  **una sola vez** cada una, y quedan anotadas en la tabla `migrations`.
- Una base nueva se arma sola desde cero; una existente solo aplica las que le faltan.
- Antes se hacía con un bash a mano. Ahora lo hace un **Cloud Run Job** dentro del pipeline, **antes** de desplegar: si
  una migración falla, la versión nueva no sale y la anterior sigue viva.
- Cómo: la imagen del Back tiene `docker-entrypoint.sh`. Con `MIGRATE_ONLY=true` aplica migraciones + seed y termina; el
  servicio se despliega con `RUN_MIGRATIONS=false` para que ninguna instancia migre al arrancar.
- Al crear una migración nueva con `migration:generate`, sustituye el `'fts_db'` literal por
  `currentDatabase(queryRunner)` y quita el prefijo `` `fts_db`. `` de `typeorm_metadata` (ver `src/database/migration-utils.ts`).

### 5.5 Cloud Storage: privado, con URLs firmadas

- **No hagas el bucket público:** cualquiera con la URL vería las fotos de evidencias.
- FTS usa **URLs firmadas**: la app pide a la API un enlace temporal (minutos) para **un** archivo, y con él sube o
  baja la foto. El bucket sigue privado.
- Para firmar, la cuenta `fts-api` necesita: `storage.objectAdmin` sobre el bucket **y** `serviceAccountTokenCreator`
  sobre sí misma (el script da ambos).
- El script crea el bucket con *acceso uniforme* y *prevención de acceso público* activada. Si tu bucket ya existía,
  fuerza esto último: `gcloud storage buckets update gs://BUCKET --public-access-prevention`.

### 5.6 Firebase (notificaciones push)

Flujo: (1) al abrir la app, el teléfono pide a Firebase un **token**; (2) la app lo manda a la API, que lo guarda;
(3) cuando pasa algo (alerta de mantenimiento, dispositivo nuevo), la API pide a Firebase "manda esto a este token";
(4) Firebase lo entrega al teléfono.

Cada lado necesita algo distinto:
- **La app:** `google-services.json` (Android) / `GoogleService-Info.plist` (iOS). Identifica la app ante Firebase.
  Van **fuera de git**. Paquete Android: `com.ftsintermodal.mobile_fts`. Bundle iOS: `com.ftsintermodal.mobileFts`
  (distinto, con `F` mayúscula).
- **La API:** permiso para enviar. En Cloud Run no se guarda ninguna llave: la cuenta `fts-api` recibe el rol
  `firebasecloudmessaging.admin` **en el proyecto de Firebase** y la API de FCM habilitada allí. La API solo necesita
  `FIREBASE_PROJECT_ID`.
- **iOS aparte:** llave APNs (`.p8`) subida a Firebase y las capabilities *Push Notifications* y *Background Modes →
  Remote notifications* en Xcode (requiere un Mac).

## 6. El día a día: qué pasa con un `git push`

1. Haces push a `staging`. El trigger arranca el pipeline (`Back/cloudbuild.yaml` o `Front/cloudbuild.yaml`).
2. **build:** `docker build --target=production` con el `Dockerfile` del repo.
3. **push:** sube la imagen a Artifact Registry (etiquetada con el id del build).
4. **migrate** (solo el Back): Job de Cloud Run con `MIGRATE_ONLY=true`. Si falla, se detiene todo.
5. **deploy:** `gcloud run deploy` con la imagen nueva. Cloud Run solo pasa el tráfico si el arranque fue sano
   (`startup probe` en `/api/v1/health/db`).

**Por qué Cloud Build y no solo el Dockerfile:** el Dockerfile define la imagen, pero no puede correr migraciones antes
del despliegue, ni pasar las `NEXT_PUBLIC_*` del Front (se fijan al *compilar*, con `--build-arg`), ni versionar los
flags de despliegue. Con `cloudbuild.yaml` todo eso queda en el repo, no en clics.

`--update-env-vars` / `--update-secrets` (no `--set-*`): solo tocan lo listado y respetan el resto de la configuración
del servicio. **Una variable no puede pasar de texto plano a secreto con el mismo nombre**: bórrala del servicio primero.

## 7. `min-instances=0`: qué implica

Sin tráfico no hay instancia corriendo. Como la API ejecuta trabajo de fondo **dentro del proceso** (BullMQ):

- Con `--no-cpu-throttling`, mientras haya una instancia viva los workers corren (Cloud Run la apaga tras ~15 min sin tráfico).
- Con la instancia apagada no se procesa nada: el relay del outbox y la telemetría esperan a la siguiente petición.
- **Cloud Scheduler `*-wake`** llama a `/health/db` cada 10 min de 02:00 a 04:59 (hora de México) para que corran los jobs
  diarios: mantenimiento 03:00, checklists 03:30, mediciones de llantas 03:35, limpieza de sesiones 04:00.
- **`TZ=America/Mexico_City`** en el servicio: Cloud Run corre en UTC y, sin esto, el "día" de las mediciones diarias
  cambiaría a las 18:00 hora de México y los crons de 03:30 serían 03:30 UTC.
- Para producción conviene `--min-instances=1` (sin depender del despertador).

## 8. Un entorno nuevo (producción)

1. **Proyecto:** lo ideal es un proyecto de Google Cloud **distinto** (aislamiento de permisos, costos y secretos).
2. **Instancia de Cloud SQL** y **base de Redis Cloud** propias (no compartas con staging).
3. `cloudrun-kit env new production` (o copia `staging.env`) y cambia proyecto, `ENV_NAME`, `SECRET_PREFIX`, `BRANCH`, base, Redis,
   bucket, Firebase, Pusher, dominios y las sustituciones (`_SUBS`).
4. `cloudrun-kit bootstrap deploy/production.env --dry-run` y revisa los `➜`.
5. `cloudrun-kit bootstrap deploy/production.env` (te pedirá los secretos; escritura oculta).
6. Configura el DNS (`CNAME` → `ghs.googlehosted.com.`) y espera el certificado.
7. Limita el usuario de la base: `--only db-grants`.
8. Compila la app móvil con `--dart-define=API_URL=https://<dominio-api>` y el `google-services.json` de ese entorno.

## 9. Un repo nuevo (otra app)

1. En la carpeta del repo: `cloudrun-kit init` (detecta Next/Nest por `package.json`; `--stack`, `--service`, `--sql` para migraciones).
   Crea `Dockerfile`, `.dockerignore` y `cloudbuild.yaml` (sin pisar lo que ya exista; `--force` para sobrescribir).
2. Asegura que la app lea `PORT` (Cloud Run inyecta 8080) y escuche en `0.0.0.0`.
3. `cloudrun-kit env new staging`, edita, y `cloudrun-kit bootstrap deploy/staging.env`.
4. Si necesita variables en **build** (`NEXT_PUBLIC_*` y similares), pásalas como `--build-arg` (ver `next.Dockerfile` y `cloudbuild.yaml`).
5. Si la app usa base con migraciones: `cloudrun-kit init --sql` (añade el Job de migraciones y `docker-entrypoint.sh`).

## 10. Problemas que ya vimos (y su causa)

| Síntoma | Causa | Solución |
|---|---|---|
| El servicio "funciona" pero muestra *Placeholder \| Cloud Run* | Cloud Run creó el servicio con la imagen de ejemplo; aún no hubo despliegue real | Ejecutar el trigger / hacer push |
| `DB_HOST=localhost` → no conecta | Cloud Run no tiene MySQL local | Cloud SQL por conector + `DB_SOCKET_PATH` |
| `Unknown database 'fts_db'` en migraciones | El nombre de la base estaba escrito a mano en 13 migraciones | `currentDatabase()` (ya corregido) |
| `Bad syntax for dict arg` al desplegar | Un valor con `@` chocaba con el separador de variables | Separador `#` |
| Migración falla y la siguiente dice "table already exists" | MySQL no revierte `CREATE TABLE`: una migración a medias deja tablas | Vaciar las tablas residuales de la base y reintentar |
| Push no se ve en Android 13+ | Faltaba `POST_NOTIFICATIONS` en el manifest | Ya agregado |
| "Firebase no inicializado" | Faltaba el plugin de Google Services / `google-services.json` | Plugin condicional + archivo en `android/app/` |
| Las mediciones diarias cambian de día a las 18:00 | Cloud Run corre en UTC | `TZ=America/Mexico_City` |
| Jobs diarios no corren | `min-instances=0` sin instancia viva | Cloud Scheduler despertador |
| Una variable no se puede pasar a secreto | Cambio de tipo con el mismo nombre | Borrarla del servicio y volver a desplegar |
| `EBADPLATFORM ... fsevents` en `npm ci` dentro de la imagen | Un `package-lock.json` generado en el host lista `fsevents` (solo macOS) sin marcarlo opcional | `npm ci --force` en los stages de build (ya en las plantillas) |
| El APK de Flutter no compila: *requires core library desugaring* | `flutter_local_notifications` lo exige en Android | `cloudrun-kit flutter-firebase` lo habilita |
| `node dist/main.js` no existe en la imagen (la salida queda en `dist/src/`) | Con TypeScript 6 falta `rootDir` en el `tsconfig` | `"rootDir": "./src"` (ya en `company-cli`) |
| `COPY /app/public: not found` al construir el Front Next | El proyecto no tiene carpeta `public/` | `public/.gitkeep` (ya lo genera `company-cli`) |

## 11. Comandos útiles

```bash
# Estado de un servicio y de sus revisiones
gcloud run services describe fts-back-staging --region us-central1 --project ingenieriascoorsa
gcloud run revisions list --service fts-back-staging --region us-central1 --project ingenieriascoorsa

# Logs de la API
gcloud run services logs read fts-back-staging --region us-central1 --project ingenieriascoorsa --limit 100

# Volver a la revisión anterior (rollback inmediato)
gcloud run services update-traffic fts-back-staging --region us-central1 --project ingenieriascoorsa --to-revisions REVISION=100

# Lanzar un build a mano sin hacer push
gcloud builds triggers run fts-back-staging-deploy --region us-central1 --project ingenieriascoorsa --branch staging

# Ver los secretos (solo nombres) y leer uno (¡no lo pegues en chats ni tickets!)
gcloud secrets list --project ingenieriascoorsa
gcloud secrets versions access latest --secret fts-db-password --project ingenieriascoorsa

# Salud
curl https://staging.api.fts.coorsamexico.com/api/v1/health/db
curl https://staging.api.fts.coorsamexico.com/api/v1/health/redis
```

## 12. Ejemplo de referencia

FTS (API NestJS + portal Next.js, Cloud SQL, Redis Cloud, Firebase) usa exactamente este flujo: ver `deploy/staging.env`,
`Back/cloudbuild.yaml` y `Front/cloudbuild.yaml` en su repo raíz.

## 13. Proyectos nuevos: el generador de Hubs

`company-cli` (sin argumentos) genera el Hub completo (Back NestJS, Front Next/Vue, Mobile Flutter) **ya listo para este flujo**: Dockerfiles
de producción no root, `cloudbuild.yaml`, base del Back (config validada, health, migraciones, Pusher, push) y `deploy/staging.env`. Tras
generar: edita `deploy/staging.env` (los `CAMBIAME`) y ejecuta `company-cli bootstrap deploy/staging.env --dry-run`.

`init` y `env new` usan **las mismas plantillas** que el generador: lo que escriben en un repo existente es idéntico a lo de un repo nuevo.

## Instalación

```bash
npm install -g @t3zcadev/company-cli                                   # desde npm
npm install -g git+https://github.com/JonathanHerSa/company-cli.git   # o desde GitHub (compila al instalar)
```

Instala los binarios `company-cli`, `t3zcadev-cli`, `create-hub-app` y `cloudrun-kit` (todos son el mismo). Requisitos para desplegar: `gcloud`,
`curl` y `openssl` (revísalo con `company-cli doctor`).

## 14. App Flutter con push: `flutter-firebase` y `firebase-app`

Aplica, de forma idempotente, lo que una app Flutter necesita para notificaciones push en Android:

- plugin de Google Services declarado (`apply false`) y **aplicado solo si existe** `android/app/google-services.json` (sin el archivo, el build sigue compilando);
- permiso `POST_NOTIFICATIONS` (obligatorio desde Android 13);
- *core library desugaring* (lo exige `flutter_local_notifications`; sin él el build falla);
- `google-services.json` y `GoogleService-Info.plist` en `.gitignore`;
- y avisa si el `google-services.json` no incluye el `applicationId` de la app.

Requiere las plataformas nativas (`flutter create --platforms=android,ios .`; `company-cli` las genera). iOS (APNs y capabilities en Xcode) sigue siendo manual.

**`firebase-app`** (también como paso 8b del `bootstrap`) crea la app Android/iOS en Firebase y descarga el archivo de configuración con la API de Firebase Management,
usando el token de `gcloud`: `company-cli firebase-app --project ID --android-package com.mi.app --android-out Mobile/android/app/google-services.json`.
Es idempotente (una app existente se reutiliza; un archivo existente no se sobrescribe sin `--force`) y admite `--dry-run`. Después, `flutter-firebase` prepara Gradle.
