const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureFirebaseApps } = require('../dist/firebase-app.js');

/** API de Firebase simulada: guarda el estado (proyecto, apps) y registra las llamadas que cambian algo. */
function fakeFirebase({ firebaseEnabled = true, androidApps = [], iosApps = [] } = {}) {
  const state = { firebaseEnabled, androidApps: [...androidApps], iosApps: [...iosApps], writes: [] };
  const json = (status, body) => ({ status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    const p = u.pathname.replace('/v1beta1/', '');
    if (method !== 'GET') state.writes.push(`${method} ${p}`);
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'GET' && p === 'projects/demo') return state.firebaseEnabled ? json(200, { projectId: 'demo' }) : json(404, { error: { message: 'not found' } });
    if (method === 'POST' && p === 'projects/demo:addFirebase') { state.firebaseEnabled = true; return json(200, { name: 'operations/op-fb' }); }
    if (method === 'GET' && p === 'projects/demo/androidApps') return json(200, { apps: state.androidApps });
    if (method === 'GET' && p === 'projects/demo/iosApps') return json(200, { apps: state.iosApps });
    if (method === 'POST' && p === 'projects/demo/androidApps') { state.androidApps.push({ packageName: body.packageName, appId: '1:1:android:new' }); return json(200, { name: 'operations/op-a' }); }
    if (method === 'POST' && p === 'projects/demo/iosApps') { state.iosApps.push({ bundleId: body.bundleId, appId: '1:1:ios:new' }); return json(200, { name: 'operations/op-i' }); }
    if (p.startsWith('operations/')) return json(200, { done: true, response: { appId: p.includes('op-i') ? '1:1:ios:new' : '1:1:android:new' } });
    if (p.endsWith('/config')) return json(200, { configFileContents: Buffer.from(p.includes('android') ? '{"client":[]}' : '<plist/>').toString('base64') });
    return json(404, { error: { message: `sin ruta: ${method} ${p}` } });
  };
  return { state, fetchImpl };
}

const base = (fake, extra = {}) => ({ project: 'demo', fetchImpl: fake.fetchImpl, getToken: async () => 't', pollMs: 1, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));

test('crea la app Android y descarga google-services.json', async () => {
  const fake = fakeFirebase();
  const out = path.join(tmp(), 'android', 'app', 'google-services.json');
  const r = await ensureFirebaseApps(base(fake, { androidPackage: 'com.acme.app', androidOut: out }));
  assert.equal(r.ok, true);
  assert.deepEqual(fake.state.writes, ['POST projects/demo/androidApps']);
  assert.equal(fs.readFileSync(out, 'utf8'), '{"client":[]}');
});

test('es idempotente: si la app y el archivo existen no cambia nada', async () => {
  const fake = fakeFirebase({ androidApps: [{ packageName: 'com.acme.app', appId: '1:1:android:old' }] });
  const out = path.join(tmp(), 'google-services.json');
  fs.writeFileSync(out, 'ORIGINAL');
  const r = await ensureFirebaseApps(base(fake, { androidPackage: 'com.acme.app', androidOut: out }));
  assert.equal(r.ok, true);
  assert.deepEqual(fake.state.writes, []);
  assert.equal(fs.readFileSync(out, 'utf8'), 'ORIGINAL');
  assert.ok(r.lines.some((l) => l.startsWith('=') && l.includes('ya existe')));
});

test('--force reemplaza el archivo', async () => {
  const fake = fakeFirebase({ androidApps: [{ packageName: 'com.acme.app', appId: '1:1:android:old' }] });
  const out = path.join(tmp(), 'google-services.json');
  fs.writeFileSync(out, 'ORIGINAL');
  await ensureFirebaseApps(base(fake, { androidPackage: 'com.acme.app', androidOut: out, force: true }));
  assert.equal(fs.readFileSync(out, 'utf8'), '{"client":[]}');
});

test('dry-run no crea ni escribe nada', async () => {
  const fake = fakeFirebase({ firebaseEnabled: false });
  const out = path.join(tmp(), 'google-services.json');
  const r = await ensureFirebaseApps(base(fake, { androidPackage: 'com.acme.app', iosBundle: 'com.acme.app', androidOut: out, dryRun: true }));
  assert.equal(r.ok, true);
  assert.deepEqual(fake.state.writes, []);
  assert.equal(fs.existsSync(out), false);
  assert.ok(r.lines.some((l) => l.startsWith('➜') && l.includes('habilitaría Firebase')));
});

test('habilita Firebase si el proyecto aún no lo es, y crea Android + iOS', async () => {
  const fake = fakeFirebase({ firebaseEnabled: false });
  const dir = tmp();
  const r = await ensureFirebaseApps(base(fake, {
    androidPackage: 'com.acme.app', androidOut: path.join(dir, 'g.json'),
    iosBundle: 'com.acme.App', iosOut: path.join(dir, 'ios', 'GoogleService-Info.plist'),
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(fake.state.writes, ['POST projects/demo:addFirebase', 'POST projects/demo/androidApps', 'POST projects/demo/iosApps']);
  assert.equal(fs.readFileSync(path.join(dir, 'ios', 'GoogleService-Info.plist'), 'utf8'), '<plist/>');
  assert.ok(r.lines.some((l) => l.includes('llave APNs')), 'avisa de lo que sigue siendo manual en iOS');
});

test('falla con un mensaje claro si la API rechaza', async () => {
  const r = await ensureFirebaseApps({ project: 'demo', getToken: async () => 't', pollMs: 1,
    androidPackage: 'com.acme.app', fetchImpl: async () => ({ status: 500, json: async () => ({ error: { message: 'boom' } }) }) });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /HTTP 500: boom/);
});
