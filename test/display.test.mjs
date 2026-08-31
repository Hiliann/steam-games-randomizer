import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { createDisplayStore, MAX_DISPLAY_BYTES } from '../lib/display-settings.mjs';
import { DISPLAY_DEFAULTS, heroBadges, formatSize, uninstalledSize, createDisplayClient } from '../public/display.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-display-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, filename: path.join(root, 'data/display-settings.json') };
}
async function listen(t, filename) {
  const app = createApp({ displaySettingsFile: filename, exclusionsFile: path.join(path.dirname(filename), 'exclusions.json') });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const url = `http://127.0.0.1:${app.address().port}`;
  const close = async () => { if (app.listening) { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); } };
  t.after(close);
  return { url, close, client: createDisplayClient((route, options) => fetch(url + route, options)) };
}
test('new copy defaults to uninstalled sizes and no installed hero badge without writing a file', async t => {
  const { root, filename } = await fixture(t);
  assert.deepEqual(await createDisplayStore(filename).read(), { showUninstalledSize: true, showInstalledBadge: false });
  assert.deepEqual(await readdir(root), []);
});
test('per-toggle concurrent writes merge, survive fresh stores and leave no temporary files', async t => {
  const { filename } = await fixture(t);
  const store = createDisplayStore(filename);
  await Promise.all([store.change({ key: 'showInstalledBadge', value: true }), store.change({ key: 'showUninstalledSize', value: false })]);
  const expected = { showUninstalledSize: false, showInstalledBadge: true };
  assert.deepEqual(await createDisplayStore(filename).read(), expected);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { version: 1, settings: expected });
  assert.deepEqual(await readdir(path.dirname(filename)), ['display-settings.json']);
});
test('invalid writes and corrupted files are rejected, never overwritten with defaults', async t => {
  const { filename } = await fixture(t);
  const store = createDisplayStore(filename);
  for (const body of [null, [], {}, { key: '__proto__', value: true }, { key: '../path', value: true }, { key: 'showInstalledBadge', value: 'false' }]) await assert.rejects(store.change(body), { status: 400 });
  await mkdir(path.dirname(filename));
  for (const source of ['{broken', '{"version":2,"settings":{}}', JSON.stringify({ version: 1, settings: { ...DISPLAY_DEFAULTS, showInstalledBadge: 1 } }), 'x'.repeat(MAX_DISPLAY_BYTES + 1)]) {
    await writeFile(filename, source);
    await assert.rejects(store.read(), { status: 503 });
    await assert.rejects(store.change({ key: 'showInstalledBadge', value: true }), { status: 503 });
    assert.equal(await readFile(filename, 'utf8'), source);
  }
});
test('fresh client and restarted HTTP server keep both display choices', async t => {
  const { filename } = await fixture(t);
  const first = await listen(t, filename);
  assert.deepEqual(await first.client.load(), DISPLAY_DEFAULTS);
  await first.client.set('showUninstalledSize', false);
  await first.client.set('showInstalledBadge', true);
  await first.close();
  const next = await listen(t, filename);
  assert.deepEqual(await next.client.load(), { showUninstalledSize: false, showInstalledBadge: true });
  await next.client.set('showUninstalledSize', true);
  assert.deepEqual(await next.client.load(), { showUninstalledSize: true, showInstalledBadge: true });
});
test('settings API is local-only, bounded and never serves private data files', async t => {
  const { filename } = await fixture(t);
  const { url } = await listen(t, filename);
  assert.equal((await fetch(url + '/api/display-settings')).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(url + '/display.js')).status, 200);
  const post = (body, headers = {}) => fetch(url + '/api/display-settings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const body = JSON.stringify({ key: 'showInstalledBadge', value: true });
  assert.equal((await post(body)).status, 403);
  assert.equal((await post(body, { 'X-Randomizer': '1', Origin: 'https://example.com' })).status, 403);
  assert.equal((await post(body, { 'X-Randomizer': '1', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('no json', { 'X-Randomizer': '1' })).status, 400);
  assert.equal((await post('x'.repeat(MAX_DISPLAY_BYTES + 1), { 'X-Randomizer': '1' })).status, 413);
  assert.equal((await post(body, { 'X-Randomizer': '1', 'Content-Type': 'text/plain' })).status, 415);
  for (const route of ['/data/display-settings.json', '/lib/display-settings.mjs']) assert.equal((await fetch(url + route)).status, 404);
});
test('client validates responses, reports save errors and uses keepalive for one small toggle', async () => {
  let options;
  const client = createDisplayClient(async (url, value) => { assert.equal(url, '/api/display-settings'); options = value; return { ok: true, json: async () => DISPLAY_DEFAULTS }; });
  await client.set('showInstalledBadge', false);
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { key: 'showInstalledBadge', value: false });
  await client.load();
  assert.equal(options.cache, 'no-store');
  assert.equal(options.body, undefined);
  await assert.rejects(createDisplayClient(async () => ({ ok: false, json: async () => ({ error: 'Not saved' }) })).set('showInstalledBadge', true), /Not saved/);
  await assert.rejects(createDisplayClient(async () => ({ ok: true, json: async () => ({ showInstalledBadge: true }) })).load(), /некорректные настройки/);
});
test('hero badges implement all four switch combinations and unknown sizes honestly', () => {
  const installed = { disk: 'F:', size: 10 * 1024 ** 3, installed: true };
  const uninstalled = { installed: false, size: 0, installSize: { bytes: 20 * 1024 ** 3, platform: 'windows', language: 'russian' } };
  for (const showInstalledBadge of [true, false]) for (const showUninstalledSize of [true, false]) {
    const settings = { showInstalledBadge, showUninstalledSize };
    assert.equal(heroBadges(installed, settings).status, showInstalledBadge ? 'F: · 10 ГБ' : '');
    assert.equal(heroBadges(installed, settings).size, '');
    const badges = heroBadges(uninstalled, settings);
    assert.equal(badges.status, 'Не установлена');
    assert.equal(badges.size, showUninstalledSize ? '≈ 20 ГБ' : '');
    if (showUninstalledSize) assert.match(badges.description, /не размер загрузки/);
  }
  assert.equal(heroBadges(installed).status, '');
  assert.equal(heroBadges(null).size, '');
  for (const bytes of [0, -1, null, undefined, NaN]) assert.equal(uninstalledSize({ installSize: { bytes } }), 'Размер не указан');
  assert.equal(formatSize(1024), '< 1 МБ');
  assert.equal(formatSize(1.5 * 1024 ** 3), '1,5 ГБ');
  assert.equal(formatSize(500 * 1024 ** 2), '500 МБ');
});
test('settings use labelled native controls, responsive badges and a guarded keyboard shortcut', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/responsive.css', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const key of Object.keys(DISPLAY_DEFAULTS)) {
    assert.ok(html.includes(`for="${key}"`));
    assert.ok(html.includes(`id="${key}" type="checkbox"`));
  }
  assert.match(html, /<dialog id="settings-dialog" aria-labelledby="settings-title"/);
  assert.match(html, /id="display-status"[^>]*role="status"/);
  assert.match(css, /\.hero-badges\s*\{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.topbar-right \.button\s*\{[^}]*min-height: 44px/);
  assert.match(app, /\$\('settings-dialog'\)\.open\) return/);
});
