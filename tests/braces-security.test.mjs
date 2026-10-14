import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bracesCompatibilityResults } from './helpers/braces-patterns.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = createRequire(import.meta.url);
const braces = load('braces');
const excessive = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
const boundedError = error => error instanceof SyntaxError && error.code === 'ERR_BRACES_DEPTH'
  && !error.message.includes('call stack');

test('local braces fork preserves 328 upstream compatibility cases', () => {
  const results = bracesCompatibilityResults(braces);
  assert.equal(results.length, 328);
  assert.equal(createHash('sha256').update(JSON.stringify(results)).digest('hex'),
    '4bb01d83a9530169cbc2c16f9f75efec7c3ca111fbb9a2dce6fe129090782832');
});

test('braces parsing counts combined brace and parenthesis nesting at the boundary', () => {
  assert.doesNotThrow(() => braces.parse('{'.repeat(128) + 'a,b' + '}'.repeat(128)));
  assert.doesNotThrow(() => braces.parse('('.repeat(128) + 'a' + ')'.repeat(128)));
  for (const pattern of [
    '{'.repeat(129), '('.repeat(129),
    '{'.repeat(64) + '('.repeat(65) + 'a' + ')'.repeat(65) + '}'.repeat(64),
  ]) {
    assert.throws(() => braces.parse(pattern), boundedError);
    assert.throws(() => braces.parse(pattern, { maxDepth: false, maxLength: Infinity }), boundedError);
  }
});

test('all public string operations reject deep patterns with a controlled diagnostic', () => {
  for (const operation of ['parse', 'compile', 'expand', 'stringify', 'create']) {
    assert.throws(() => braces[operation](excessive), boundedError, operation);
  }
  assert.throws(() => braces(excessive), boundedError);
  assert.throws(() => braces(['{x,y}', excessive], { expand: true }), boundedError);
});

function deepAst(depth) {
  const ast = { type: 'root', nodes: [] };
  let parent = ast;
  for (let index = 0; index < depth; index++) {
    const node = { type: 'paren', nodes: [], parent };
    parent.nodes.push(node);
    parent = node;
  }
  parent.nodes.push({ type: 'text', value: 'x', parent });
  return ast;
}

test('public and internal AST walkers cannot bypass the depth bound', () => {
  for (const operation of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[operation](deepAst(4000)), boundedError, operation);
    const internal = load(`braces/lib/${operation}`);
    assert.throws(() => internal(deepAst(4000)), boundedError, operation);
    const cyclic = { type: 'root', nodes: [] };
    cyclic.nodes.push(cyclic);
    assert.throws(() => internal(cyclic), boundedError, `${operation}: cyclic children`);
  }
  const cyclicParent = { type: 'paren', nodes: [] };
  cyclicParent.parent = cyclicParent;
  assert.throws(() => braces.expand(cyclicParent), boundedError, 'cyclic parent traversal');
});

test('literal escapes, quotes and character classes do not count as nested containers', () => {
  for (const pattern of ['\\{'.repeat(4000), '"' + '{'.repeat(4000) + '"', '[' + '('.repeat(4000) + ']']) {
    assert.doesNotThrow(() => braces.compile(pattern));
    assert.doesNotThrow(() => braces.stringify(pattern));
  }
  assert.throws(() => braces.parse('x'.repeat(10001)), SyntaxError, 'upstream character cap remains');
  assert.throws(() => braces.expand('{1..2000}'), RangeError, 'upstream range cap remains');
});

test('deep-input guards work in an isolated process with a 256 KiB stack', () => {
  const script = `const assert=require('node:assert/strict'),b=require('braces');
    const tooDeep='{'.repeat(4000)+'a,b'+'}'.repeat(4000);
    for(const op of ['compile','expand','stringify']) {
      assert.throws(()=>b[op](tooDeep),e=>e instanceof SyntaxError&&e.code==='ERR_BRACES_DEPTH');
      assert.doesNotThrow(()=>b[op]('{'.repeat(128)+'a,b'+'}'.repeat(128)));
    }
    console.log('bounded');`;
  const result = spawnSync(process.execPath, ['--stack-size=256', '-e', script],
    { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bounded');
});

test('every installed braces consumer resolves the reviewed local fork', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const vendorEntry = realpathSync(path.join(root, 'vendor/braces/index.js'));
  assert.equal(realpathSync(load.resolve('braces')), vendorEntry);
  assert.equal(load('braces/package.json').name, '@pantokrator-atlas/braces');
  assert.equal(load('braces/package.json').version, '3.0.3-atlas.1');
  const entries = Object.entries(lock.packages).filter(([key]) => /(^|\/)node_modules\/braces$/.test(key));
  assert.ok(entries.length > 0);
  for (const [key, metadata] of entries) {
    assert.equal(metadata.link, true, `${key} must not silently revert to an upstream copy`);
    assert.equal(metadata.resolved, 'vendor/braces');
  }
  const consumers = Object.keys(lock.packages).filter(key => /(^|\/)node_modules\/micromatch$/.test(key));
  assert.ok(consumers.length > 0);
  for (const key of consumers) {
    const consumerLoad = createRequire(path.join(root, key, 'package.json'));
    assert.equal(realpathSync(consumerLoad.resolve('braces')), vendorEntry);
    assert.throws(() => consumerLoad('braces').compile(excessive), boundedError);
  }
});

test('unchanged upstream implementation and MIT license retain their provenance hashes', () => {
  const expected = {
    'index.js': '332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4',
    'lib/utils.js': 'b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7',
    'lib/constants.js': 'c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b',
    LICENSE: '35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2',
  };
  for (const [file, digest] of Object.entries(expected)) {
    const text = readFileSync(path.join(root, 'vendor/braces', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(text).digest('hex'), digest, file);
  }
});

test('third-party inventory identifies the local fork and preserves its MIT notice', () => {
  const notices = readFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
  assert.match(notices, /@pantokrator-atlas\/braces@3\.0\.3-atlas\.1 \| MIT \| node_modules\/braces/);
  assert.match(notices, /@pantokrator-atlas\/braces@3\.0\.3-atlas\.1 \(LICENSE\)/);
  assert.match(notices, /Copyright \(c\) 2014-present, Jon Schlinkert\./);
  assert.doesNotMatch(notices, /@undefined|\| undefined \|/);
});
