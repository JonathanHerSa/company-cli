const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureGitignore, SECRET_PATTERNS, STACK_PATTERNS } = require('../dist/gitignore.js');
const templates = require('../dist/templates.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));

test('crea el .gitignore si no existe', async () => {
  const dir = tmp();
  const added = await ensureGitignore(dir, ['.env', 'dist']);
  assert.deepEqual(added, ['.env', 'dist']);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^# Añadido por company-cli/m);
});

test('no duplica, y trata /node_modules, node_modules/ y node_modules como el mismo patrón', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), '/node_modules\ndist/\n# comentario\n.env\n');
  assert.deepEqual(await ensureGitignore(dir, ['node_modules', 'dist', '.env', 'coverage']), ['coverage']);
});

test('es idempotente y respeta el contenido existente', async () => {
  const dir = tmp();
  const original = 'mi-carpeta/\n*.tmp';
  fs.writeFileSync(path.join(dir, '.gitignore'), original);
  await ensureGitignore(dir, SECRET_PATTERNS);
  const once = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
  assert.ok(once.startsWith(original + '\n'));
  assert.deepEqual(await ensureGitignore(dir, SECRET_PATTERNS), []);
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), once);
});

test('las negaciones (!.env.template) se conservan como patrones distintos', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n');
  assert.deepEqual(await ensureGitignore(dir, ['.env.*', '!.env.template']), ['!.env.template']);
});

test('todas las plantillas de .gitignore del generador ignoran secretos y llaves de servicio', () => {
  const opts = { projectName: 'Demo', githubOrg: '', services: ['back'], backendOrm: 'typeorm', frontendFramework: 'next', database: 'mysql', targetDir: '' };
  for (const name of ['getRootGitignore', 'getBackGitignore', 'getFrontGitignore', 'getMobileGitignore']) {
    const content = templates[name](opts);
    for (const pattern of ['.env', '*.pem', '*-firebase-adminsdk-*.json', 'service-account*.json']) {
      assert.ok(content.split('\n').includes(pattern), `${name} debe ignorar ${pattern}`);
    }
  }
  assert.ok(templates.getMobileGitignore().split('\n').includes('key.properties'), 'Mobile ignora la firma de Android');
});

test('los patrones por stack cubren dependencias y build', () => {
  assert.ok(STACK_PATTERNS.nest.includes('dist') && STACK_PATTERNS.next.includes('.next') && STACK_PATTERNS.flutter.includes('build'));
});
