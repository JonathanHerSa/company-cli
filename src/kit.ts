import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

import * as deploy from './deploy.js';
import { resolveAllDockerVersions } from './docker.js';
import { ensureFirebaseApps } from './firebase-app.js';
import { applyFlutterFirebase } from './flutter-firebase.js';
import { ensureGitignore, SECRET_PATTERNS, STACK_PATTERNS } from './gitignore.js';
import type { ProjectOptions } from './templates.js';

/**
 * Comandos de despliegue a Google Cloud Run + Cloud Build (`company-cli <comando>` o su alias `cloudrun-kit <comando>`).
 * Comparten plantillas con el generador de Hubs (`assets/cloudrun/`): lo que `init` escribe en un repo existente es
 * exactamente lo que el generador escribe en uno nuevo.
 */
const PKG_ROOT = path.join(__dirname, '..');
const BOOTSTRAP_SH = path.join(PKG_ROOT, 'kit', 'bootstrap.sh');
const GUIDE_MD = path.join(PKG_ROOT, 'docs', 'guia-despliegue.md');

export const DEPLOY_COMMANDS = ['init', 'env', 'bootstrap', 'flutter-firebase', 'firebase-app', 'doctor', 'guide', 'where'] as const;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function packageVersion(): string {
  try {
    return (fs.readJsonSync(path.join(PKG_ROOT, 'package.json')) as { version: string }).version;
  } catch {
    return 'dev';
  }
}

export function deployHelp(invokedAs: string): string {
  return `${invokedAs} ${packageVersion()} — despliegue a Google Cloud Run + Cloud Build para cualquier repo

Uso:
  ${invokedAs} init [--stack nest|next|vue] [--service NOMBRE] [--sql] [--force]
        En el repo actual: Dockerfile de producción (no root, puerto de Cloud Run), .dockerignore, cloudbuild.yaml y completa el
        .gitignore (secretos, llaves de Firebase, artefactos de build) sin duplicar lo que ya tenga.
        El stack se detecta por package.json. --sql añade migraciones (Cloud Run Job) y Cloud SQL. No pisa archivos
        existentes salvo con --force.
  ${invokedAs} env new <entorno> [--app NOMBRE] [--sql]
        Crea deploy/<entorno>.env: la definición COMPLETA de un entorno (sin secretos). En una carpeta con Back/ y Front/
        (un Hub) incluye los dos componentes; en un repo suelto, uno.
  ${invokedAs} bootstrap <archivo.env> [--dry-run] [--yes] [--only pasos] [--skip pasos]
        Crea en Google Cloud todo lo que el pipeline necesita (APIs, repositorio de imágenes, cuentas, secretos,
        permisos, base de datos, bucket, triggers, primer despliegue, dominios). Idempotente. Empieza con --dry-run.
        Pasos: apis registry accounts secrets iam sql-instance sql bucket firebase firebase-app github triggers build domains dns scheduler verify
        Opcional: --only db-grants (limita el usuario de la base a su propia base)
  ${invokedAs} flutter-firebase [carpeta]
        Prepara una app Flutter para push (FCM) en Android, de forma idempotente.
  ${invokedAs} firebase-app --project ID --android-package PKG [--ios-bundle ID] [--android-out RUTA] [--ios-out RUTA] [--dry-run] [--force]
        Crea la app Android/iOS en Firebase (si no existe) y descarga google-services.json / GoogleService-Info.plist.
  ${invokedAs} doctor     Revisa gcloud, sesión, proyecto y herramientas.
  ${invokedAs} guide      Muestra la guía completa paso a paso.
  ${invokedAs} where      Ruta de instalación.
`;
}

interface Detected {
  stack: 'nest' | 'next' | 'vue' | 'none';
  hasSql: boolean;
}

/** Detecta el stack de un repo por su package.json. */
async function detectStack(dir: string): Promise<Detected> {
  const file = path.join(dir, 'package.json');
  if (!(await fs.pathExists(file))) return { stack: 'none', hasSql: false };
  const pkg = (await fs.readJson(file)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const hasSql = Boolean(deps.typeorm && (deps.mysql2 || deps.pg));
  if (deps.next) return { stack: 'next', hasSql };
  if (deps['@nestjs/core']) return { stack: 'nest', hasSql };
  if (deps.vue) return { stack: 'vue', hasSql };
  return { stack: 'none', hasSql };
}

async function gcloudProject(): Promise<string> {
  const { stdout } = await execa('gcloud', ['config', 'get-value', 'project'], { reject: false });
  return stdout.trim() && !stdout.includes('(unset)') ? stdout.trim() : '';
}

/** Quita el sufijo de rol (`-api`, `-web`, `-back`...) para obtener el prefijo de la app: `mi-tienda-web` → `mi-tienda`. */
const appFromName = (name: string): string => slug(name).replace(/-(api|web|back|front|backend|frontend|app|service)$/, '');

interface Flags {
  project?: string;
  androidPackage?: string;
  iosBundle?: string;
  androidOut?: string;
  iosOut?: string;
  name?: string;
  dryRun?: boolean;
  stack?: string;
  service?: string;
  app?: string;
  sql: boolean;
  force: boolean;
  positional: string[];
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { sql: false, force: false, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stack') flags.stack = args[++i];
    else if (arg === '--service') flags.service = args[++i];
    else if (arg === '--app') flags.app = args[++i];
    else if (arg === '--sql') flags.sql = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--project') flags.project = args[++i];
    else if (arg === '--android-package') flags.androidPackage = args[++i];
    else if (arg === '--ios-bundle') flags.iosBundle = args[++i];
    else if (arg === '--android-out') flags.androidOut = args[++i];
    else if (arg === '--ios-out') flags.iosOut = args[++i];
    else if (arg === '--name') flags.name = args[++i];
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`opción desconocida: ${arg}`);
    else flags.positional.push(arg);
  }
  return flags;
}

async function baseOptions(dir: string, name: string, extra: Partial<ProjectOptions>): Promise<ProjectOptions> {
  return {
    projectName: name,
    githubOrg: '',
    services: ['back'],
    backendOrm: 'typeorm',
    frontendFramework: 'next',
    database: 'none',
    targetDir: dir,
    cloudRun: true,
    gcpProjectId: await gcloudProject(),
    gcpRegion: 'us-central1',
    dockerVersions: await resolveAllDockerVersions(),
    ...extra,
  };
}

function printResults(results: deploy.WriteResult[], root: string): void {
  for (const r of results) {
    const rel = path.relative(root, r.file) || r.file;
    console.log(r.status === 'created' ? `  + ${rel}` : `  = ${rel} (ya existe; usa --force para sobrescribir)`);
  }
}

async function cmdInit(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  const dir = process.cwd();
  const detected = await detectStack(dir);
  const stack = (flags.stack ?? detected.stack) as Detected['stack'];
  if (!['nest', 'next', 'vue'].includes(stack)) {
    console.error('No detecté Next.js, NestJS ni Vue en package.json. Indica el stack: --stack nest|next|vue');
    return 1;
  }
  console.log(`Stack: ${stack}${flags.stack ? '' : ' (detectado)'}`);

  const service = flags.service ?? path.basename(dir);
  // Migraciones + Cloud SQL: con --sql, o si el repo ya usa TypeORM con MySQL/PostgreSQL.
  const sql = flags.sql || (stack === 'nest' && detected.hasSql);
  const opts = await baseOptions(dir, appFromName(service) || slug(service), {
    services: stack === 'nest' ? ['back'] : ['front'],
    frontendFramework: stack === 'vue' ? 'vue' : 'next',
    database: sql ? 'mysql' : 'none',
  });

  const io: deploy.WriteIO = { skipExisting: !flags.force, results: [] };
  if (stack === 'nest') {
    await deploy.writeBackDocker(dir, opts, io);
    await deploy.writeBackCloudBuild(dir, opts, io);
  } else {
    await deploy.writeFrontDocker(dir, opts, io);
    await deploy.writeFrontCloudBuild(dir, opts, io);
  }
  printResults(io.results ?? [], dir);

  // `.gitignore`: completa (sin duplicar ni reordenar) lo que falte para que secretos, llaves y artefactos de build no lleguen a git.
  const stackKey = stack === 'nest' ? 'nest' : stack === 'vue' ? 'vue' : 'next';
  const added = await ensureGitignore(dir, [...SECRET_PATTERNS, ...STACK_PATTERNS[stackKey]]);
  console.log(added.length > 0 ? `  + .gitignore (${added.length} entradas: ${added.join(', ')})` : '  = .gitignore (ya cubre secretos y artefactos de build)');

  const warnings: string[] = [];
  if (stack === 'nest') {
    warnings.push('El Dockerfile ejecuta `node dist/main.js`: comprueba que `nest build` deje ahí el resultado (tsconfig con "rootDir": "./src").');
    warnings.push('La app debe leer `PORT` (Cloud Run inyecta 8080) y escuchar en 0.0.0.0.');
    if (sql) warnings.push('Con --sql tu package.json necesita el script `migration:run:prod` (lo ejecuta el Job de migraciones).');
  }
  if (stack === 'next') warnings.push('next.config debe tener `output: "standalone"`; el Dockerfile usa el servidor standalone.');
  if (warnings.length > 0) console.log(`\nRevisa:\n${warnings.map((w) => `  - ${w}`).join('\n')}`);
  console.log(`
Siguiente:
  1. Revisa cloudbuild.yaml (sustituciones).
  2. Define el entorno:   company-cli env new staging${sql ? ' --sql' : ''}
  3. Simula:              company-cli bootstrap deploy/staging.env --dry-run
  4. Guía completa:       company-cli guide`);
  return 0;
}

async function cmdEnv(args: string[]): Promise<number> {
  if (args[0] !== 'new') {
    console.error('Uso: env new <entorno> [--app NOMBRE] [--sql] [--force]');
    return 2;
  }
  const flags = parseFlags(args.slice(1));
  const env = flags.positional[0];
  if (!env) {
    console.error('Falta el nombre del entorno (p. ej. staging, production)');
    return 2;
  }
  const dir = process.cwd();
  const dest = path.join(dir, 'deploy', `${slug(env)}.env`);
  if ((await fs.pathExists(dest)) && !flags.force) {
    console.error(`${path.relative(dir, dest)} ya existe (usa --force para sobrescribir)`);
    return 1;
  }

  // Hub (carpeta con Back/ y/o Front/) o repo suelto.
  const hasBack = await fs.pathExists(path.join(dir, 'Back'));
  const hasFront = await fs.pathExists(path.join(dir, 'Front'));
  const isHub = hasBack || hasFront;
  let services: ProjectOptions['services'];
  let frontendFramework: ProjectOptions['frontendFramework'] = 'next';
  let sql = flags.sql;

  if (isHub) {
    services = [...(hasBack ? (['back'] as const) : []), ...(hasFront ? (['front'] as const) : [])];
    if (hasFront) frontendFramework = (await detectStack(path.join(dir, 'Front'))).stack === 'vue' ? 'vue' : 'next';
    if (hasBack) sql = sql || (await detectStack(path.join(dir, 'Back'))).hasSql;
  } else {
    const detected = await detectStack(dir);
    if (detected.stack === 'none') {
      console.error('No detecté el stack (Next, NestJS o Vue) ni una carpeta Back/Front. Ejecuta el comando en la raíz de un repo o de un Hub.');
      return 1;
    }
    services = detected.stack === 'nest' ? ['back'] : ['front'];
    frontendFramework = detected.stack === 'vue' ? 'vue' : 'next';
    sql = sql || detected.hasSql;
  }

  const app = flags.app ?? appFromName(path.basename(dir).replace(/_hub$/, ''));
  const opts = await baseOptions(dir, app, { services, frontendFramework, database: sql ? 'mysql' : 'none', deployEnv: env });
  await deploy.writeEnvFile(dest, opts, { skipExisting: false, results: [] });
  console.log(`Creado ${path.relative(dir, dest)} (${isHub ? 'Hub' : 'repo'}: ${services.join(' + ')}). Edítalo (todo lo que diga CAMBIAME) y luego:`);
  console.log(`  company-cli bootstrap ${path.relative(dir, dest)} --dry-run`);
  return 0;
}

async function cmdBootstrap(args: string[]): Promise<number> {
  const { exitCode } = await execa('bash', [BOOTSTRAP_SH, ...args], { stdio: 'inherit', reject: false });
  return exitCode ?? 1;
}

async function cmdFlutterFirebase(args: string[]): Promise<number> {
  const root = path.resolve(args[0] ?? '.');
  const report = await applyFlutterFirebase(root);
  for (const line of report.lines) console.log(line ? `  ${line}` : '');
  return report.ok ? 0 : 1;
}

async function cmdFirebaseApp(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  if (!flags.project || (!flags.androidPackage && !flags.iosBundle)) {
    console.error('Uso: firebase-app --project ID --android-package PKG [--ios-bundle ID] [--android-out RUTA] [--ios-out RUTA] [--name NOMBRE] [--dry-run] [--force]');
    return 2;
  }
  const result = await ensureFirebaseApps({
    project: flags.project,
    androidPackage: flags.androidPackage,
    iosBundle: flags.iosBundle,
    androidOut: flags.androidOut ? path.resolve(flags.androidOut) : undefined,
    iosOut: flags.iosOut ? path.resolve(flags.iosOut) : undefined,
    displayName: flags.name,
    dryRun: flags.dryRun,
    force: flags.force,
  });
  for (const line of result.lines) console.log(`  ${line}`);
  return result.ok ? 0 : 1;
}

async function cmdDoctor(): Promise<number> {
  let bad = false;
  const has = async (bin: string) => (await execa('bash', ['-c', `command -v ${bin}`], { reject: false })).exitCode === 0;
  console.log('Herramientas:');
  for (const [bin, hint, required] of [
    ['gcloud', 'https://cloud.google.com/sdk', true],
    ['curl', 'necesaria para verify', true],
    ['openssl', 'genera secretos', true],
    ['docker', 'opcional: probar imágenes en local', false],
    ['gh', 'opcional: conceder acceso de la app de Cloud Build a los repos de GitHub', false],
    ['dig', 'opcional: comprobar la propagación del DNS', false],
    ['cloud-sql-proxy', 'opcional: solo para db-grants', false],
    ['mariadb', 'opcional: solo para db-grants', false],
  ] as const) {
    if (await has(bin)) console.log(`  ✔ ${bin}`);
    else {
      console.log(`  ${required ? '✖' : '·'} ${bin} (${hint})`);
      if (required) bad = true;
    }
  }
  console.log('Sesión de Google Cloud:');
  const account = (await execa('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { reject: false })).stdout.trim();
  if (account) console.log(`  ✔ cuenta activa: ${account}`);
  else {
    console.log('  ✖ sin sesión: gcloud auth login');
    bad = true;
  }
  console.log(`  · proyecto por defecto: ${(await gcloudProject()) || '(ninguno)'}`);
  return bad ? 1 : 0;
}

async function cmdGuide(): Promise<number> {
  const pager = process.env.PAGER || 'less';
  const { exitCode } = await execa(pager, [GUIDE_MD], { stdio: 'inherit', reject: false });
  if (exitCode !== 0) console.log(await fs.readFile(GUIDE_MD, 'utf8'));
  return 0;
}

export async function runDeployCommand(command: string, args: string[]): Promise<number> {
  try {
    switch (command) {
      case 'init':
        return await cmdInit(args);
      case 'env':
        return await cmdEnv(args);
      case 'bootstrap':
        return await cmdBootstrap(args);
      case 'flutter-firebase':
        return await cmdFlutterFirebase(args);
      case 'firebase-app':
        return await cmdFirebaseApp(args);
      case 'doctor':
        return await cmdDoctor();
      case 'guide':
        return await cmdGuide();
      case 'where':
        console.log(PKG_ROOT);
        return 0;
      default:
        return 2;
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
