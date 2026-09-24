import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

import { applyFlutterFirebase } from './flutter-firebase.js';
import { mobilePackageName, type ProjectOptions } from './templates.js';

/**
 * Despliegue a Google Cloud Run + Cloud Build, listo desde el primer commit: lo que hizo funcionar a FTS
 * (configuración validada, base por socket de Cloud SQL, migraciones fuera del arranque, health, Pusher, push con
 * credenciales por defecto, Dockerfiles no root en el puerto de Cloud Run, cloudbuild.yaml y la definición del entorno).
 *
 * Las plantillas viven como archivos reales en `assets/cloudrun/` (editables y con resaltado), no como cadenas gigantes.
 * Se procesan con un preprocesador mínimo:
 *   - `@if <bandera>` / `@else` / `@endif` (en una línea de comentario de cualquier lenguaje) incluyen o quitan bloques.
 *     Se admiten `!bandera` y anidamiento. Las líneas de directiva no se escriben.
 *   - `__TOKEN__` se sustituye por su valor (ver `tokensFor`).
 * La misma lógica de despliegue vive en `cloudrun-kit` (CLI global); estas plantillas son su equivalente empaquetado para
 * que el CLI funcione también vía `npx`, sin depender de que el kit esté instalado.
 */
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'cloudrun');

export type Flags = Record<string, boolean>;

export function flagsFor(opts: ProjectOptions): Flags {
  const sqlDb = opts.database === 'mysql' || opts.database === 'postgres';
  return {
    back: opts.services.includes('back'),
    front: opts.services.includes('front'),
    mobile: opts.services.includes('mobile'),
    next: opts.frontendFramework === 'next',
    vue: opts.frontendFramework === 'vue',
    mysql: opts.database === 'mysql',
    postgres: opts.database === 'postgres',
    hasDb: opts.database !== 'none',
    // Base de datos SQL con TypeORM: es lo que trae módulo de base de datos, migraciones y `health/db`.
    hasTypeorm: sqlDb && opts.backendOrm === 'typeorm',
    // Cloud SQL: aplica a MySQL y PostgreSQL (Mongo y otras iría a Atlas u otro servicio administrado).
    hasCloudSql: sqlDb,
    cloudRun: opts.cloudRun !== false,
  };
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Organización inversa del paquete Android/iOS (`com.acme`): la usa `flutter create --org` y el paso `firebase-app`. */
const appOrg = (opts: ProjectOptions): string => `com.${(opts.githubOrg || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

/** Base para nombres de bases de datos: solo `[a-z0-9_]` (un guion obligaría a citar el nombre en SQL). */
const dbBase = (opts: ProjectOptions): string => opts.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const TZ = 'America/Mexico_City';

export const envNameOf = (opts: ProjectOptions): string => slug(opts.deployEnv || 'staging') || 'staging';
/** Prefijo de claves de Redis por entorno (`stg:`, `prod:`): dos entornos que comparten Redis no se pisan. */
const redisPrefixOf = (env: string): string => (env === 'staging' ? 'stg:' : env === 'production' ? 'prod:' : `${env}:`);
/** Rama que despliega cada entorno: `staging` → rama `staging`; el resto → `main`. */
const branchOf = (env: string): string => (env === 'staging' ? 'staging' : 'main');
const API_PREFIX = 'api/v1';

/** Valor de `SECRETS` (variable=secreto:latest) que usa el cloudbuild del Back por defecto. */
function secretsDefault(opts: ProjectOptions): string {
  const prefix = slug(opts.projectName);
  const list: string[] = [];
  if (opts.database !== 'none') list.push(`DB_PASSWORD=${prefix}-db-password:latest`);
  list.push(
    `JWT_SECRET=${prefix}-jwt-secret:latest`,
    `JWT_REFRESH_SECRET=${prefix}-jwt-refresh-secret:latest`,
    `MFA_ENCRYPTION_KEY=${prefix}-mfa-encryption-key:latest`,
    `PUSHER_SECRET=${prefix}-pusher-secret:latest`,
    `REDIS_PASSWORD=${prefix}-redis-password:latest`,
  );
  return list.join(',');
}

/** Sustituciones del trigger del Back (delimitador `|`, `^|^` inicial). Deben coincidir con `assets/.../back/cloudbuild.yaml`. */
function backSubs(opts: ProjectOptions, flags: Flags): string {
  const envName = envNameOf(opts);
  const dbName = `${dbBase(opts)}_db_${envName}`;
  const subs = ['^|^_REGION=${REGION}', '_AR_REPO=${AR_REPO}', '_RUNTIME_SA=${SA_back}', '_SERVICE=${SVC_back}', '_SECRETS=${SECRETS_FLAG}'];
  if (flags.hasCloudSql) subs.push('_MIGRATE_JOB=${JOB_back}', '_CLOUDSQL_INSTANCE=${SQL_CONN}');

  const env = [
    'NODE_ENV=production',
    `TZ=${TZ}`,
    'TRUST_PROXY=1',
    `CORS_ORIGIN=${flags.front ? '${URL_front}' : 'CAMBIAME-origen-cors'}`,
  ];
  if (flags.hasCloudSql) {
    env.push('DB_HOST=localhost', 'DB_SOCKET_PATH=/cloudsql/${SQL_CONN}', `DB_USERNAME=${dbName}`, `DB_DATABASE=${dbName}`);
  } else if (flags.hasDb) {
    env.push('DB_HOST=CAMBIAME-host-db', `DB_USERNAME=${dbName}`, `DB_DATABASE=${dbName}`);
  }
  env.push(
    'REDIS_HOST=CAMBIAME-host-de-redis',
    'REDIS_PORT=CAMBIAME-puerto',
    `REDIS_PREFIX=${redisPrefixOf(envName)}`,
    'PUSHER_APP_ID=CAMBIAME',
    'PUSHER_KEY=CAMBIAME',
    'PUSHER_CLUSTER=us2',
  );
  if (flags.mobile) env.push('FIREBASE_PROJECT_ID=CAMBIAME');
  subs.push(`_ENV_VARS=${env.join('#')}`);
  return subs.join('|');
}

function frontSubs(flags: Flags): string {
  const subs = ['^|^_REGION=${REGION}', '_AR_REPO=${AR_REPO}', '_SERVICE=${SVC_front}', '_RUNTIME_SA=${SA_front}'];
  const api = flags.back ? '${URL_back}' : 'https://CAMBIAME-url-de-la-api.run.app';
  if (flags.next) {
    subs.push(`_INTERNAL_API_URL=${api}`, '_SITE_URL=', '_PUSHER_KEY=CAMBIAME', '_PUSHER_CLUSTER=us2');
  } else {
    subs.push(`_API_URL=${api}/${API_PREFIX}`);
  }
  return subs.join('|');
}

export function tokensFor(opts: ProjectOptions): Record<string, string> {
  const flags = flagsFor(opts);
  const lower = opts.projectName.toLowerCase();
  const components = ['back', 'front'].filter((c) => (c === 'back' ? flags.back : flags.front));
  return {
    __PROJECT_NAME__: opts.projectName,
    __ENV__: envNameOf(opts),
    __BRANCH__: branchOf(envNameOf(opts)),
    __DB_STAGE_NAME__: `${dbBase(opts)}_db_${envNameOf(opts)}`,
    __MOBILE_PACKAGE__: mobilePackageName(opts),
    __ANDROID_PACKAGE__: `${appOrg(opts)}.${mobilePackageName(opts)}`,
    __PROJECT__: slug(opts.projectName),
    __DB_NAME__: `${dbBase(opts)}_db`,
    __DB_PORT__: opts.databasePort || (opts.database === 'postgres' ? '5432' : opts.database === 'mongo' ? '27017' : '3306'),
    __GITHUB_ORG__: opts.githubOrg || 'CAMBIAME-organizacion',
    __GCP_PROJECT__: opts.gcpProjectId || 'CAMBIAME-proyecto-gcp',
    __GCP_REGION__: opts.gcpRegion || 'us-central1',
    __NODE_TAG__: opts.dockerVersions?.node || '22-alpine',
    __NGINX_TAG__: opts.dockerVersions?.nginx || '1.27-alpine',
    __API_PREFIX__: API_PREFIX,
    __TZ__: TZ,
    __COMPONENTS__: components.join(' '),
    __FRONT_FRAMEWORK__: flags.next ? 'Next.js' : 'Vue 3',
    __FRONT_HEALTH__: '/',
    __SECRETS_DEFAULT__: secretsDefault(opts),
    __BACK_SUBS__: backSubs(opts, flags),
    __FRONT_SUBS__: frontSubs(flags),
  };
}

/** Preprocesador de plantillas: `@if` / `@else` / `@endif` y `__TOKEN__`. */
export function render(source: string, flags: Flags, tokens: Record<string, string>): string {
  const out: string[] = [];
  // Cada nivel guarda si su rama actual está activa; una línea se escribe si TODOS los niveles lo están.
  const stack: { active: boolean; parentActive: boolean; taken: boolean }[] = [];
  const active = () => stack.every((s) => s.active);

  for (const line of source.split('\n')) {
    const ifMatch = line.match(/@if\s+(!?)(\w+)/);
    if (ifMatch && /^\s*(?:\/\/|#|<!--|\/\*)/.test(line)) {
      const value = ifMatch[1] === '!' ? !flags[ifMatch[2]] : Boolean(flags[ifMatch[2]]);
      stack.push({ active: value, parentActive: active(), taken: value });
      continue;
    }
    if (/@else\b/.test(line) && /^\s*(?:\/\/|#|<!--|\/\*)/.test(line)) {
      const top = stack[stack.length - 1];
      if (!top) throw new Error('@else sin @if');
      top.active = !top.taken;
      top.taken = true;
      continue;
    }
    if (/@endif\b/.test(line) && /^\s*(?:\/\/|#|<!--|\/\*)/.test(line)) {
      if (!stack.pop()) throw new Error('@endif sin @if');
      continue;
    }
    if (active()) out.push(line);
  }
  if (stack.length > 0) throw new Error('@if sin cerrar');

  // Los tokens más largos primero: `__PROJECT_NAME__` antes que `__PROJECT__`.
  let text = out.join('\n');
  for (const key of Object.keys(tokens).sort((a, b) => b.length - a.length)) {
    text = text.split(key).join(tokens[key]);
  }
  return text;
}

export interface WriteResult {
  file: string;
  status: 'created' | 'skipped';
}

/** `skipExisting`: no pisar archivos que ya existen (`init` en un repo con historia). `results` acumula lo escrito. */
export interface WriteIO {
  skipExisting?: boolean;
  results?: WriteResult[];
}

async function writeAsset(rel: string, dest: string, opts: ProjectOptions, executable = false, io: WriteIO = {}): Promise<void> {
  if (io.skipExisting && (await fs.pathExists(dest))) {
    io.results?.push({ file: dest, status: 'skipped' });
    return;
  }
  const source = await fs.readFile(path.join(ASSETS_DIR, rel), 'utf8');
  await fs.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, render(source, flagsFor(opts), tokensFor(opts)));
  if (executable) await fs.chmod(dest, 0o755);
  io.results?.push({ file: dest, status: 'created' });
}

// ── Back (NestJS) ──────────────────────────────────────────────────────────────────────────────

/** Base del Back: configuración validada, base de datos, health, plataforma (Pusher, push, client-config), main y módulo raíz. */
export async function writeBackBase(servicePath: string, opts: ProjectOptions): Promise<void> {
  const flags = flagsFor(opts);
  const files: [string, string][] = [
    ['back/src/config/envs.ts', 'src/config/envs.ts'],
    ['back/src/common/controllers/health.controller.ts', 'src/common/controllers/health.controller.ts'],
    ['back/src/platform/pusher.service.ts', 'src/platform/pusher.service.ts'],
    ['back/src/platform/client-config.service.ts', 'src/platform/client-config.service.ts'],
    ['back/src/platform/client-config.controller.ts', 'src/platform/client-config.controller.ts'],
    ['back/src/platform/platform.module.ts', 'src/platform/platform.module.ts'],
    ['back/src/main.ts', 'src/main.ts'],
    ['back/src/app.module.ts', 'src/app.module.ts'],
  ];
  if (flags.mobile) files.push(['back/src/platform/push.service.ts', 'src/platform/push.service.ts']);
  if (flags.hasTypeorm) {
    files.push(
      ['back/src/config/typeorm-options.ts', 'src/config/typeorm-options.ts'],
      ['back/src/database/data-source.ts', 'src/database/data-source.ts'],
      ['back/src/database/database.module.ts', 'src/database/database.module.ts'],
      ['back/src/database/base.entity.ts', 'src/database/base.entity.ts'],
      ['back/src/database/migrations/.gitkeep', 'src/database/migrations/.gitkeep'],
    );
  }
  for (const [from, to] of files) await writeAsset(from, path.join(servicePath, to), opts);
}

/** Dockerfile de producción (no root, puerto de Cloud Run), entrypoint con migraciones y `.dockerignore`. */
export async function writeBackDocker(servicePath: string, opts: ProjectOptions, io?: WriteIO): Promise<void> {
  await writeAsset('back/Dockerfile', path.join(servicePath, 'Dockerfile'), opts, false, io);
  await writeAsset('back/docker-entrypoint.sh', path.join(servicePath, 'docker-entrypoint.sh'), opts, true, io);
  await writeAsset('back/.dockerignore', path.join(servicePath, '.dockerignore'), opts, false, io);
}

export async function writeBackCloudBuild(servicePath: string, opts: ProjectOptions, io?: WriteIO): Promise<void> {
  await writeAsset('back/cloudbuild.yaml', path.join(servicePath, 'cloudbuild.yaml'), opts, false, io);
}

/** Scripts de migraciones según el ORM. El entrypoint ejecuta `migration:run:prod` (si existe) en el Job de migraciones. */
export function backMigrationScripts(opts: ProjectOptions): Record<string, string> {
  if (opts.database === 'none') return {};
  switch (opts.backendOrm) {
    case 'typeorm':
      return {
        typeorm: 'typeorm-ts-node-commonjs',
        'migration:generate': 'npm run typeorm -- migration:generate -d src/database/data-source.ts',
        'migration:run': 'npm run typeorm -- migration:run -d src/database/data-source.ts',
        'migration:revert': 'npm run typeorm -- migration:revert -d src/database/data-source.ts',
        'migration:run:prod': 'typeorm migration:run -d dist/database/data-source.js',
        'migration:revert:prod': 'typeorm migration:revert -d dist/database/data-source.js',
      };
    case 'prisma':
      return { 'migration:run': 'prisma migrate dev', 'migration:run:prod': 'prisma migrate deploy' };
    case 'drizzle':
      return { 'migration:run': 'drizzle-kit migrate', 'migration:run:prod': 'drizzle-kit migrate' };
    default:
      return {};
  }
}

/** Dependencias que necesita el código de base del Back y que el generador no traía. */
export function backExtraDeps(opts: ProjectOptions): Record<string, string> {
  const deps: Record<string, string> = { ioredis: 'latest' };
  if (flagsFor(opts).hasTypeorm) deps['typeorm-naming-strategies'] = 'latest';
  // El CLI de migraciones corre dentro de la imagen de producción (Job de Cloud Run): debe estar en `dependencies`.
  if (opts.backendOrm === 'prisma' && opts.database !== 'none') deps.prisma = 'latest';
  if (opts.backendOrm === 'drizzle' && opts.database !== 'none') deps['drizzle-kit'] = 'latest';
  return deps;
}

// ── Front ──────────────────────────────────────────────────────────────────────────────────────

/** Solo lo de despliegue del Front (Dockerfile, .dockerignore, nginx para Vue): es lo que `init` escribe en un repo existente. */
export async function writeFrontDocker(servicePath: string, opts: ProjectOptions, io?: WriteIO): Promise<void> {
  await writeAsset('front/Dockerfile', path.join(servicePath, 'Dockerfile'), opts, false, io);
  await writeAsset('front/.dockerignore', path.join(servicePath, '.dockerignore'), opts, false, io);
  if (flagsFor(opts).vue) await writeAsset('front/nginx.conf', path.join(servicePath, 'nginx.conf'), opts, false, io);
}

/** Código de la app (no de despliegue): cliente de Pusher que no tumba la pantalla si falta la key. Solo Next.js. */
export async function writeFrontBase(servicePath: string, opts: ProjectOptions): Promise<void> {
  if (flagsFor(opts).next) {
    await writeAsset('front/src/lib/realtime/pusher-client.ts', path.join(servicePath, 'src', 'lib', 'realtime', 'pusher-client.ts'), opts);
  }
}

export async function writeFrontCloudBuild(servicePath: string, opts: ProjectOptions, io?: WriteIO): Promise<void> {
  await writeAsset('front/cloudbuild.yaml', path.join(servicePath, 'cloudbuild.yaml'), opts, false, io);
}

// ── Mobile ─────────────────────────────────────────────────────────────────────────────────────

/** Config de build (`API_URL`), `client-config` del Back y README de push. Genera `android/` e `ios/` con `flutter create` si se puede. */
export async function writeMobileCloudRun(servicePath: string, opts: ProjectOptions, onNote?: (message: string) => void): Promise<string[]> {
  const notes: string[] = [];
  await writeAsset('mobile/lib/core/config/env.dart', path.join(servicePath, 'lib', 'core', 'config', 'env.dart'), opts);
  await writeAsset('mobile/lib/core/config/client_config.dart', path.join(servicePath, 'lib', 'core', 'config', 'client_config.dart'), opts);
  await writeAsset('mobile/README.md', path.join(servicePath, 'README.md'), opts);

  // Plataformas nativas: `flutter create .` respeta pubspec.yaml y lib/main.dart existentes. Sin ellas no hay dónde aplicar
  // los cambios de Firebase (plugin de Google Services, permiso de notificaciones).
  const name = mobilePackageName(opts);
  const org = appOrg(opts);
  try {
    onNote?.('Generando las plataformas nativas de Flutter (android, ios)...');
    await execa('flutter', ['create', '--project-name', name, '--org', org, '--platforms', 'android,ios', '.'], { cwd: servicePath });
    // `flutter create` deja un test de ejemplo (contador) que no corresponde a esta app y haría fallar `flutter test`.
    const sampleTest = path.join(servicePath, 'test', 'widget_test.dart');
    if ((await fs.pathExists(sampleTest)) && (await fs.readFile(sampleTest, 'utf8')).includes('Counter')) await fs.remove(sampleTest);
    const report = await applyFlutterFirebase(servicePath);
    if (!report.ok) notes.push(`Mobile: no se pudo preparar Firebase (${report.lines[0] ?? 'error'}). Ejecuta \`company-cli flutter-firebase\` cuando existan las plataformas nativas.`);
  } catch {
    notes.push('Mobile: ejecuta `flutter create --platforms=android,ios .` y luego `company-cli flutter-firebase` (push con Firebase).');
  }
  return notes;
}

// ── Hub (repo raíz) ────────────────────────────────────────────────────────────────────────────

export async function writeHubCloudRun(hubPath: string, opts: ProjectOptions): Promise<void> {
  await writeAsset('hub/deploy/staging.env', path.join(hubPath, 'deploy', `${envNameOf(opts)}.env`), opts);
  await writeAsset('hub/docs/deploy.md', path.join(hubPath, 'docs', 'deploy.md'), opts);
}

/** Solo la definición de un entorno (`deploy/<entorno>.env`): la usa `env new` en un repo o Hub existente. */
export async function writeEnvFile(dest: string, opts: ProjectOptions, io?: WriteIO): Promise<void> {
  await writeAsset('hub/deploy/staging.env', dest, opts, false, io);
}
