# 🚀 @t3zcadev/company-cli

> **Inicializador Institucional de Proyectos Hub** con arquitectura multi-repo, soporte para Docker, pipelines CI/CD automatizados y reglas de IA generativas.

Desarrollado y mantenido por **[T3zcaDev](https://github.com/JonathanHerSa)**.

---

## ⚡ Instalación y Uso

Tienes dos formas principales de utilizar la herramienta:

### 1. 📌 Instalación Global (Recomendado para uso frecuente)
Para instalar la herramienta de forma permanente en tu sistema y poder usar el comando directo en cualquier terminal:

```bash
npm install -g @t3zcadev/company-cli
```

Una vez instalado, puedes ejecutar el comando directo desde cualquier carpeta:

```bash
t3zcadev-cli
# o también:
create-hub-app
# o:
company-cli
```

---

### 2. ⚡ Ejecución Instantánea sin Instalación (`npx`)
Si prefieres no instalar nada en tu sistema y siempre usar la versión más reciente:

```bash
npx @t3zcadev/company-cli
```

---

### 3. 🛠️ Instalación desde Repositorio Privado (Colaboradores / Git)
Si aún no se ha publicado en NPM o prefieres instalar desde el repositorio de Git:

```bash
git clone https://github.com/JonathanHerSa/company-cli.git
cd company-cli
npm install
npm install -g .
```

---

## ✨ Características Principales

- 🏗️ **Arquitectura Hub Multi-Repo**: Estructura proyectos escalables separando servicios backend y apps frontend.
- 🐳 **Docker & Docker Compose integrados**: Generación automática de contenedores optimizados para desarrollo y producción.
- 🔄 **Pipelines CI/CD**: Automatización con GitHub Actions lista para producción.
- 🤖 **Reglas de IA Generativas**: Integración de contextos y prompt rules para asistentes IA (GitHub Copilot, Cursor, Antigravity, ChatGPT).
- 🎨 **Stack Tecnológico Soportado**:
  - **Backend**: NestJS
  - **Frontend Web**: Next.js / Vue.js
  - **Mobile**: Flutter

---

## ☁️ Despliegue en Google Cloud Run (listo desde el primer commit)

Cada proyecto generado ya trae lo necesario para desplegarse a **Cloud Run + Cloud Build** (lo mismo que hizo funcionar a FTS):

| Repo | Qué incluye |
|---|---|
| **Back** (NestJS) | Configuración validada con Joi (`src/config/envs.ts`), base de datos TypeORM (MySQL/PostgreSQL) con soporte de **socket de Cloud SQL**, scripts de migraciones (`migration:run:prod`), `GET /api/v1/health` (+ `/health/db`, `/health/redis`), `GET /api/v1/client-config` (key de Pusher para las apps), `PusherService`, `PushService` (FCM con credenciales por defecto, sin llave privada), `main.ts` listo para Cloud Run (`PORT`, `0.0.0.0`, `trust proxy`, `/reference` solo fuera de producción), `Dockerfile` de producción **no root**, `docker-entrypoint.sh` (migraciones en un Job, `MIGRATE_ONLY`) y `cloudbuild.yaml` |
| **Front** (Next.js / Vue) | `Dockerfile` de producción no root (Next `standalone` con `--build-arg` para `NEXT_PUBLIC_*`; Vue con nginx sin privilegios), `.dockerignore`, `cloudbuild.yaml` y cliente de Pusher que no tumba la pantalla si falta la key |
| **Mobile** (Flutter) | `Env` (`--dart-define=API_URL=...`), `ClientConfigRepository` (config desde el Back), plataformas nativas (`flutter create`) y preparación de Firebase (plugin de Google Services condicional, permiso `POST_NOTIFICATIONS`, *core library desugaring*) |
| **Hub** (raíz) | `deploy/staging.env` (definición del entorno, sin secretos) y `docs/deploy.md` |

Durante la generación el CLI pregunta si preparar el despliegue (`cloudbuild.yaml`, `deploy/staging.env`) y el ID del proyecto/región de Google Cloud.
Los Dockerfiles de producción y la base del Backend se generan siempre.

### Crear el entorno en Google Cloud

El despliegue viene **en este mismo CLI** (sin nada más que instalar; también se invoca como `cloudrun-kit`). Requiere `gcloud`, `curl` y `openssl` (`company-cli doctor`). Edita `deploy/staging.env` (todo lo que diga `CAMBIAME`) y:

```bash
company-cli bootstrap deploy/staging.env --dry-run    # simula: solo lee, muestra qué existe y qué se crearía
company-cli bootstrap deploy/staging.env              # crea APIs, repositorio de imágenes, cuentas, secretos, permisos, base, triggers y primer despliegue
company-cli guide                                     # guía completa paso a paso
```

Es idempotente (repetirlo es seguro) y se niega a ejecutarse mientras queden valores `CAMBIAME`.
Las plantillas están en `assets/cloudrun/` (archivos reales; `@if bandera` / `@else` / `@endif` y `__TOKEN__` se resuelven en `src/deploy.ts`).

### Comandos de despliegue (también con el alias `cloudrun-kit`)

| Comando | Qué hace |
|---|---|
| `company-cli init [--stack nest\|next\|vue] [--sql] [--force]` | En un repo existente: `Dockerfile` de producción, `.dockerignore` y `cloudbuild.yaml` (las mismas plantillas que el generador; no pisa archivos salvo `--force`) |
| `company-cli env new <entorno>` | Crea `deploy/<entorno>.env` (definición completa del entorno, sin secretos) para un repo o un Hub |
| `company-cli bootstrap <env> [--dry-run]` | Crea en Google Cloud todo lo que el pipeline necesita (incluye, opcional, la instancia de Cloud SQL, la app de Firebase con su `google-services.json` y el acceso de GitHub); idempotente. El DNS de Squarespace y otros sin API se muestra como registro exacto y se verifica |
| `company-cli firebase-app --project ID --android-package PKG` | Crea la app Android/iOS en Firebase (si no existe) y descarga `google-services.json` / `GoogleService-Info.plist`; idempotente, con `--dry-run` |
| `company-cli flutter-firebase [carpeta]` | Prepara una app Flutter para push (plugin de Google Services condicional, `POST_NOTIFICATIONS`, *desugaring*) |
| `company-cli doctor` / `guide` / `where` | Revisa herramientas y sesión / muestra la guía / ruta de instalación |

Sin argumentos, `company-cli` abre el asistente que crea un Hub nuevo.

---

## 🛠️ Desarrollo Local

Si deseas contribuir o modificar el CLI:

```bash
# 1. Clonar el repositorio
git clone https://github.com/JonathanHerSa/company-cli.git

# 2. Instalar dependencias
npm install

# 3. Compilar TypeScript
npm run build

# 4. Probar localmente
npm run dev

# 5. Enlazar comando ejecutable en tu máquina
npm link
```

---

## 👤 Autor

**T3zcaDev**
- GitHub: [@JonathanHerSa](https://github.com/JonathanHerSa)

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**.
