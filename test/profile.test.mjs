import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createProfileStore, DEFAULT_CATEGORIES, MAX_PROFILE_BYTES } from '../lib/profile.mjs';
import { createProfileClient } from '../public/profile.js';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-profile-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, filename: path.join(root, 'data/profile.json') };
}
async function listen(t, filename) {
  const app = createApp({ profileFile: filename, scan: async () => ({ games: [], libraries: [], warnings: [] }) });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => { if (app.listening) { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); } });
  return { url, client: createProfileClient((route, options) => fetch(url + route, options)) };
}

test('missing profile migrates the browser draw once and survives a fresh store', async t => {
  const { root, filename } = await fixture(t);
  const store = createProfileStore(filename);
  const missing = await store.read();
  assert.equal(missing.initialized, false);
  assert.deepEqual(missing.categories, DEFAULT_CATEGORIES);
  assert.deepEqual(await readdir(root), []);
  const saved = await store.change({ action: 'initialize', draw: { seen: ['10'], current: '10', history: [{ id: '10', at: '2026-09-01T10:00:00Z' }], mode: 'category:favorite' } });
  assert.equal(saved.initialized, true);
  assert.deepEqual(saved.draw.seen, ['10']);
  assert.equal(saved.draw.mode, 'category:favorite');
  assert.deepEqual((await createProfileStore(filename).read()).draw, saved.draw);
});

test('categories can be assigned, renamed, created and deleted without losing other games', async t => {
  const { filename } = await fixture(t);
  const store = createProfileStore(filename);
  let profile = await store.change({ action: 'initialize', draw: {} });
  profile = await store.change({ action: 'set-category', revision: profile.revision, appId: '10', categoryId: 'favorite', assigned: true });
  profile = await store.change({ action: 'set-category', revision: profile.revision, appId: '20', categoryId: 'company', assigned: true });
  profile = await store.change({ action: 'rename-category', revision: profile.revision, id: 'favorite', name: 'Самые любимые' });
  profile = await store.change({ action: 'add-category', revision: profile.revision, name: 'На выходные' });
  const custom = profile.categories.find(item => item.name === 'На выходные');
  profile = await store.change({ action: 'set-category', revision: profile.revision, appId: '10', categoryId: custom.id, assigned: true });
  profile = await store.change({ action: 'delete-category', revision: profile.revision, id: 'favorite' });
  assert.deepEqual(profile.assignments['10'], [custom.id]);
  assert.deepEqual(profile.assignments['20'], ['company']);
  assert.equal(profile.categories.some(item => item.id === 'favorite'), false);
});

test('revision rejects stale tabs and draw replacement preserves categories', async t => {
  const { filename } = await fixture(t);
  const store = createProfileStore(filename);
  const first = await store.change({ action: 'initialize', draw: {} });
  const second = await store.change({ action: 'replace-draw', revision: first.revision, draw: { seen: ['10'], current: '10', mode: 'unplayed' } });
  await assert.rejects(store.change({ action: 'add-category', revision: first.revision, name: 'Устаревшая вкладка' }), { status: 409 });
  assert.deepEqual((await store.read()).draw, second.draw);
  assert.deepEqual((await store.read()).categories, second.categories);
});

test('corrupt, invalid and oversized profiles are preserved', async t => {
  const { filename } = await fixture(t);
  await mkdir(path.dirname(filename));
  for (const source of ['{broken', '{"version":2}', JSON.stringify({ version: 1, revision: 1, categories: [], assignments: { '../file': [] }, draw: {} }), 'x'.repeat(MAX_PROFILE_BYTES + 1)]) {
    await writeFile(filename, source);
    await assert.rejects(createProfileStore(filename).read(), { status: 503 });
    assert.equal(await readFile(filename, 'utf8'), source);
  }
});

test('profile API is local-only, bounded and client validates responses', async t => {
  const { filename } = await fixture(t);
  const { url, client } = await listen(t, filename);
  const profile = await client.load({ seen: ['10'], current: '10' });
  assert.deepEqual(profile.draw.seen, ['10']);
  const updated = await client.setCategory(profile.revision, '10', 'favorite', true);
  assert.deepEqual(updated.assignments['10'], ['favorite']);
  const post = (body, headers = {}) => fetch(url + '/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('{}')).status, 403);
  assert.equal((await post('{}', { 'X-Randomizer': '1', Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('x'.repeat(MAX_PROFILE_BYTES + 1), { 'X-Randomizer': '1' })).status, 413);
  for (const route of ['/data/profile.json', '/lib/profile.mjs', '/api/profile/../data/profile.json']) assert.equal((await fetch(url + route)).status, 404);
  const malformed = createProfileClient(async () => ({ ok: true, json: async () => ({ initialized: true, revision: 1, categories: [], assignments: [] }) }));
  await assert.rejects(malformed.load({}), /некорректные категории/);
});

test('category and draw-mode controls are wired into the responsive interface', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/responsive.css', import.meta.url), 'utf8');
  for (const id of ['categories-button', 'categories-dialog', 'category-list', 'add-category-form', 'category-filter', 'draw-mode', 'hero-categories']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(app, /eligibleGames\(games, state, profile\.assignments\)/);
  assert.match(app, /profileClient\.replaceDraw/);
  assert.match(app, /profileClient\.setCategory/);
  assert.match(app, /includeUninstalled: next\.includeUninstalled, customPaths: next\.customPaths/);
  assert.match(css, /\.library-tools\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.category-manage-row\s*\{[^}]*grid-template-columns/s);
});
