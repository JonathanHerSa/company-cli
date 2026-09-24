import fs from 'fs-extra';
import path from 'path';

/**
 * Patrones que NUNCA deben llegar a git: variables de entorno y llaves. Fuente única: la usan las plantillas de `.gitignore`
 * del generador y `init` (que completa el `.gitignore` de un repo existente).
 */
export const SECRET_PATTERNS = [
  '.env',
  '.env.*',
  '!.env.template',
  '!.env.example',
  '*.pem',
  // Llave de cuenta de servicio de Firebase que se baja de la consola (`<proyecto>-firebase-adminsdk-xxxxx.json`): da control del proyecto.
  '*-firebase-adminsdk-*.json',
  'service-account*.json',
  'storage-credentials.json',
];

/** Artefactos de build y dependencias por stack. */
export const STACK_PATTERNS: Record<'nest' | 'next' | 'vue' | 'flutter', string[]> = {
  nest: ['node_modules', 'dist', 'coverage', '*.tsbuildinfo', 'logs', '*.log', 'storage/uploads'],
  next: ['node_modules', '.next', 'out', 'coverage', '*.tsbuildinfo', 'next-env.d.ts', 'logs', '*.log'],
  vue: ['node_modules', 'dist', 'coverage', '*.tsbuildinfo', 'logs', '*.log'],
  flutter: [
    '.dart_tool',
    'build',
    // Firma de Android: quien las tenga puede publicar en nombre de la app.
    '*.jks',
    '*.keystore',
    'key.properties',
    'google-services.json',
    'GoogleService-Info.plist',
  ],
};

/** Bloque de texto con los patrones de secretos, para pegarlo al final de una plantilla de `.gitignore`. */
export function secretIgnoreBlock(): string {
  return `\n# Secretos y llaves (nunca a git)\n${SECRET_PATTERNS.join('\n')}\n`;
}

/** `/node_modules`, `node_modules/` y `node_modules` son el mismo patrón para nuestros fines. */
const normalize = (line: string): string => (line.startsWith('!') ? line.trim() : line.trim().replace(/^\/+/, '').replace(/\/+$/, ''));

/**
 * Añade a `<dir>/.gitignore` los patrones que falten (y lo crea si no existe). Idempotente: no duplica ni reordena lo existente.
 * Devuelve los patrones que añadió.
 */
export async function ensureGitignore(dir: string, patterns: string[]): Promise<string[]> {
  const file = path.join(dir, '.gitignore');
  const existing = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : '';
  const present = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(normalize),
  );
  const missing = [...new Set(patterns)].filter((pattern) => !present.has(normalize(pattern)));
  if (missing.length === 0) return [];
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.appendFile(file, `${prefix}${existing ? '\n' : ''}# Añadido por company-cli (secretos y artefactos de build)\n${missing.join('\n')}\n`);
  return missing;
}
