const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../dist/deploy.js');

test('@if / @else / @endif con comentarios de varios lenguajes y anidamiento', () => {
  const src = ['a', '// @if x', 'b', '# @if y', 'c', '# @else', 'd', '# @endif', '// @else', 'e', '// @endif', 'f'].join('\n');
  assert.equal(render(src, { x: true, y: true }, {}), 'a\nb\nc\nf');
  assert.equal(render(src, { x: true, y: false }, {}), 'a\nb\nd\nf');
  assert.equal(render(src, { x: false, y: true }, {}), 'a\ne\nf');
});

test('!bandera niega', () => {
  assert.equal(render('# @if !x\nsi\n# @endif', { x: false }, {}), 'si');
  assert.equal(render('# @if !x\nsi\n# @endif', { x: true }, {}), '');
});

test('los tokens más largos se sustituyen primero (__PROJECT_NAME__ antes que __PROJECT__)', () => {
  assert.equal(render('__PROJECT_NAME__ __PROJECT__ __PROJECT___back', {}, { __PROJECT__: 'demo', __PROJECT_NAME__: 'Demo App' }), 'Demo App demo demo_back');
});

test('directivas sin cerrar o sobrantes lanzan error', () => {
  assert.throws(() => render('# @if x\na', { x: true }, {}), /sin cerrar/);
  assert.throws(() => render('# @endif', {}, {}), /sin @if/);
});
