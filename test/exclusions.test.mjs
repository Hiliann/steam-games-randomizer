import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createExclusionsStore, MAX_EXCLUSIONS_BYTES } from '../lib/exclusions.mjs';
import { createApp } from '../server.mjs';
import { createExclusionsClient } from '../public/exclusions.js';
import { cleanState, drawGame } from '../public/randomizer.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-exclusions-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, filename: path.join(root, 'data/exclusions.json') };
}
async function listen(t, filename) {
  const app = createApp({ exclusionsFile: filename, scan: async () => ({ games: [], libraries: [], warnings: [] }) });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  const close = async () => { if (app.listening) { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); } };
  t.after(close);
  return { app, url, close, client: createExclusionsClient((route, options) => fetch(url + route, options)) };
}

test('missing store stays read-only until initialization; data survives creating a fresh store', async t => {
  const { root, filename } = await fixture(t);
  const store = createExclusionsStore(filename);
  assert.deepEqual(await store.read(), { initialized: false, excluded: [] });
  assert.deepEqual(await readdir(root), []);
  await store.change({ action: 'initialize', excluded: ['10', '20', '10'] });
  assert.deepEqual((await createExclusionsStore(filename).read()).excluded, ['10', '20']);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { version: 1, excluded: ['10', '20'] });
  assert.deepEqual(await readdir(path.dirname(filename)), ['exclusions.json']);
});

test('stale browser imports cannot replace saved exclusions or resurrect an intentionally empty list', async t => {
  const { filename } = await fixture(t);
  const store = createExclusionsStore(filename);
  await store.change({ action: 'initialize', excluded: ['10'] });
  assert.deepEqual((await store.change({ action: 'initialize', excluded: [] })).excluded, ['10']);
  await store.change({ action: 'set', id: '10', excluded: false });
  assert.deepEqual(await createExclusionsStore(filename).change({ action: 'initialize', excluded: ['10', '20'] }), { initialized: true, excluded: [] });
});

test('concurrent per-game writes are merged and idempotent instead of replacing browser snapshots', async t => {
  const { filename } = await fixture(t);
  const store = createExclusionsStore(filename);
  const ids = Array.from({ length: 35 }, (_, i) => String(i + 100));
  await Promise.all(ids.map(id => store.change({ action: 'set', id, excluded: true })));
  assert.deepEqual((await store.read()).excluded, ids);
  await Promise.all(ids.slice(0, 10).map(id => store.change({ action: 'set', id, excluded: false })));
  await store.change({ action: 'set', id: ids[10], excluded: true });
  assert.deepEqual((await store.read()).excluded, ids.slice(10));
});

test('corrupted, wrong-version or oversized saved files are preserved and never reset to empty', async t => {
  const { filename } = await fixture(t);
  await mkdir(path.dirname(filename));
  for (const source of ['{broken', '{"version":2,"excluded":[]}', '{"version":1,"excluded":["../secret"]}', 'x'.repeat(MAX_EXCLUSIONS_BYTES + 1)]) {
    await writeFile(filename, source);
    const store = createExclusionsStore(filename);
    await assert.rejects(store.read(), { status: 503 });
    await assert.rejects(store.change({ action: 'initialize', excluded: [] }), { status: 503 });
    await assert.rejects(store.change({ action: 'set', id: '10', excluded: true }), { status: 503 });
    assert.equal(await readFile(filename, 'utf8'), source);
  }
});

test('invalid operations and IDs cannot alter the saved list; queue recovers after rejection', async t => {
  const { filename } = await fixture(t);
  const store = createExclusionsStore(filename);
  await store.change({ action: 'set', id: '10', excluded: true });
  const invalid = [null, [], {}, { action: 'delete' }, { action: 'initialize', excluded: '10' }, { action: 'initialize', excluded: Array(20001).fill('10') }, ...['../file', 'javascript:alert(1)', '4294967296', 10].map(id => ({ action: 'set', id, excluded: true })), { action: 'set', id: '10', excluded: 'false' }];
  for (const body of invalid) await assert.rejects(store.change(body), { status: 400 });
  assert.deepEqual((await store.read()).excluded, ['10']);
  await store.change({ action: 'set', id: '20', excluded: true });
  assert.deepEqual((await store.read()).excluded, ['10', '20']);
});

test('maximum supported migration list is persisted without truncation', async t => {
  const { filename } = await fixture(t);
  const { client } = await listen(t, filename);
  const ids = Array.from({ length: 20000 }, (_, i) => String(1000000 + i));
  assert.deepEqual(await client.load(ids), ids);
  assert.deepEqual((await createExclusionsStore(filename).read()).excluded, ids);
});

test('fresh browser and restarted HTTP server preserve exclusions and affect the draw pool', async t => {
  const { filename } = await fixture(t);
  const first = await listen(t, filename);
  assert.deepEqual(await first.client.load(['10']), ['10']);
  await first.client.set('20', true);
  await first.close();
  const next = await listen(t, filename);
  // Empty legacy state simulates cleared storage or a different origin/browser.
  const excluded = await next.client.load([]);
  assert.deepEqual(excluded, ['10', '20']);
  const games = ['10', '20', '30'].map(id => ({ id, name: id }));
  assert.equal(drawGame(games, cleanState({ excluded }), () => 0).game.id, '30');
  await next.client.set('10', false);
  await next.close();
  const last = await listen(t, filename);
  assert.deepEqual(await last.client.load(['10', '20']), ['20']);
});

test('exclusions API requires same-origin app writes and never serves the file directly', async t => {
  const { filename } = await fixture(t);
  const { url, client } = await listen(t, filename);
  const response = await fetch(url + '/api/exclusions');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(url + '/exclusions.js')).status, 200);
  const post = (body, headers = {}) => fetch(url + '/api/exclusions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const mutation = JSON.stringify({ action: 'set', id: '10', excluded: true });
  assert.equal((await post(mutation)).status, 403);
  assert.equal((await post(mutation, { 'X-Randomizer': '1', Origin: 'https://example.com' })).status, 403);
  assert.equal((await post(mutation, { 'X-Randomizer': '1', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('bad json', { 'X-Randomizer': '1' })).status, 400);
  assert.equal((await post('x'.repeat(MAX_EXCLUSIONS_BYTES + 1), { 'X-Randomizer': '1' })).status, 413);
  assert.equal((await post(mutation, { 'X-Randomizer': '1', 'Content-Type': 'text/plain' })).status, 415);
  await client.set('10', true);
  for (const route of ['/data/exclusions.json', '/lib/exclusions.mjs', '/api/exclusions/../data/exclusions.json']) assert.equal((await fetch(url + route)).status, 404);
});

test('client uses keepalive for immediate mutations, not whole-list overwrite or unload saving', async () => {
  let options;
  const client = createExclusionsClient(async (url, value) => {
    assert.equal(url, '/api/exclusions'); options = value;
    return { ok: true, json: async () => ({ initialized: true, excluded: ['10'] }) };
  });
  await client.set('10', true);
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { action: 'set', id: '10', excluded: true });
  await client.load([]);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.body, undefined);
});

test('client reports read/write errors and never initializes after a failed read', async () => {
  const calls = [];
  const client = createExclusionsClient(async (url, options) => {
    calls.push(options);
    return { ok: false, json: async () => ({ error: 'Cannot read saved data' }) };
  });
  await assert.rejects(client.load([]), /Cannot read saved data/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, undefined);
  await assert.rejects(client.set('10', true), /Cannot read saved data/);
  const malformed = createExclusionsClient(async () => ({ ok: true, json: async () => ({ excluded: [] }) }));
  await assert.rejects(malformed.load([]), /некорректный список/);
});
