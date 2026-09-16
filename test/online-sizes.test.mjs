import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { cleanStoreDescription, createOnlineSizeService, parseStorageRequirement, SIZE_CACHE_TTL, SIZE_MISS_TTL, MAX_SIZE_RESPONSE } from '../lib/online-sizes.mjs';
import { createOnlineSizesClient } from '../public/online-sizes.js';
import { createDescriptionsClient } from '../public/descriptions.js';
import { uninstalledSize, sizeDescription, sizeSourceUrl, heroBadges } from '../public/display.js';
import { createApp } from '../server.mjs';
import { createDisplayStore } from '../lib/display-settings.mjs';

const GB = 1024 ** 3;
const storage = n => ({ minimum: `<strong>Minimum:</strong><ul><li><strong>Memory:</strong> 8 GB RAM</li><li><strong>Storage:</strong> ${n} GB available space</li></ul>` });
const steam = (id, requirements = storage(100), extras = {}) => new Response(JSON.stringify({ [id]: { success: true, data: { steam_appid: Number(id), pc_requirements: requirements, ...extras } } }), { headers: { 'content-type': 'application/json' } });
const options = { interval: 0, wait: async () => {} };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-online-sizes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, filename: path.join(root, 'data/online-sizes.json') };
}

test('Steam HTML storage parsing excludes RAM, graphics memory and HTML scripts', () => {
  assert.equal(parseStorageRequirement(storage(100)), 100 * GB);
  assert.equal(parseStorageRequirement({ minimum: '<li>Memory: 16 GB RAM</li><li>Graphics: 8 GB VRAM</li><li>Additional Notes: 100 GB RAM</li>' }), null);
  assert.equal(parseStorageRequirement({ minimum: '<script>Storage: 999 GB</script><li>Storage: 5 GB available space</li>' }), 5 * GB);
  for (const value of [undefined, null, [], '', { minimum: 'x'.repeat(128001) }]) assert.equal(parseStorageRequirement(value), null);
});
test('storage parsing supports older labels, units, decimals, ranges and safer larger requirement', () => {
  for (const [text, bytes] of [['Hard Drive: 500 MB free', 500 * 1024 ** 2], ['Disk space: 1.5 GB', 1.5 * GB], ['Storage: 1,024 MB', GB], ['Storage: 1,5 GB', 1.5 * GB], ['Storage: 20\u201330 GB available', 30 * GB], ['HDD: 0.5 TB free', 512 * GB], ['Место на диске: 10 ГБ', 10 * GB]]) assert.equal(parseStorageRequirement({ minimum: text }), bytes, text);
  assert.equal(parseStorageRequirement({ ...storage(100), recommended: '<li>Storage: 120 GB available</li>' }), 120 * GB);
  for (const text of ['Storage: -1 GB', 'Storage: 0 GB', 'Storage: TBD', 'Storage: 999999999999999 GB']) assert.equal(parseStorageRequirement({ minimum: text }), null);
});
test('short Steam descriptions are plain, bounded text and cached per interface language', async t => {
  const { filename } = await fixture(t);
  let calls = 0;
  const service = createOnlineSizeService({ ...options, filename, send: async url => {
    calls++;
    const language = new URL(url).searchParams.get('l');
    return steam('10', storage(1), { short_description: language === 'russian' ? '<b>Короткое</b> описание &amp; детали.' : '<script>bad()</script>A short description.' });
  } });
  assert.equal(cleanStoreDescription('<b>Hello</b> &amp; welcome'), 'Hello & welcome');
  assert.equal(cleanStoreDescription('<script>alert(1)</script>'), null);
  assert.equal((await service.lookupDescription('10', 'russian')).description, 'Короткое описание & детали.');
  assert.equal((await service.lookupDescription('10', 'english')).description, 'A short description.');
  assert.equal(calls, 2);
  const restarted = createOnlineSizeService({ ...options, filename, send: async () => { throw new Error('Must use cache'); } });
  assert.equal((await restarted.lookupDescription('10', 'russian')).cached, true);
  assert.equal((await restarted.lookupDescription('10', 'english')).sourceUrl, 'https://store.steampowered.com/app/10/');
  assert.equal(calls, 2);
  await assert.rejects(service.lookupDescription('../secret', 'english'), { status: 400 });
  await assert.rejects(service.lookupDescription('10', 'ukrainian'), { status: 400 });
});
test('lookup uses only a fixed HTTPS Steam host and public ID, with correct platform selection', async () => {
  const calls = [];
  const service = createOnlineSizeService({ ...options, send: async (url, opts) => { calls.push({ url, opts }); return steam('10', storage(100), { linux_requirements: storage(20), mac_requirements: storage(30) }); } });
  assert.equal((await service.lookup('10', 'linux')).size.bytes, 20 * GB);
  assert.equal((await service.lookup('10', 'macos')).size.bytes, 30 * GB);
  assert.equal((await service.lookup('10')).size.bytes, 100 * GB);
  for (const { url, opts } of calls) {
    assert.equal(new URL(url).host, 'store.steampowered.com');
    assert.equal(new URL(url).searchParams.get('appids'), '10');
    assert.equal(opts.redirect, 'error');
    assert.equal(opts.credentials, 'omit');
    assert.equal(opts.headers.Cookie, undefined);
  }
  for (const id of ['../secret', 'https://example.com', '4294967296', 10]) await assert.rejects(service.lookup(id), { status: 400 });
  await assert.rejects(service.lookup('10', '__proto__'), { status: 400 });
});
test('same-game lookups are deduplicated; persisted results survive restart without network', async t => {
  const { filename } = await fixture(t);
  let calls = 0;
  const service = createOnlineSizeService({ ...options, filename, send: async () => { calls++; await setImmediate(); return steam('10'); } });
  const results = await Promise.all(Array.from({ length: 8 }, () => service.lookup('10')));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.size.bytes === 100 * GB));
  assert.deepEqual(await readdir(path.dirname(filename)), ['online-sizes.json']);
  const restarted = createOnlineSizeService({ ...options, filename, send: async () => { throw new Error('Must not use network'); } });
  assert.equal((await restarted.getCached('10')).bytes, 100 * GB);
  const cached = await restarted.lookup('10');
  assert.equal(cached.cached, true);
  assert.equal(cached.status, 'ready');
  assert.equal(cached.size.sourceUrl, 'https://store.steampowered.com/app/10/');
});
test('missing store entries or storage are negatively cached, never confused with RAM', async t => {
  const { filename } = await fixture(t);
  let time = 1000000000000, calls = 0;
  const service = createOnlineSizeService({ ...options, filename, now: () => time, send: async () => { calls++; return steam('10', { minimum: 'Memory: 16 GB RAM' }); } });
  assert.equal((await service.lookup('10')).status, 'not-found');
  assert.equal((await service.lookup('10')).size, null);
  assert.equal(calls, 1);
  time += SIZE_MISS_TTL + 1;
  await service.lookup('10'); assert.equal(calls, 2);
  const removed = createOnlineSizeService({ ...options, send: async () => new Response('{"10":{"success":false}}') });
  assert.equal((await removed.lookup('10')).status, 'not-found');
});
test('expired known data remains available offline and survives new missing requirements', async t => {
  const { filename } = await fixture(t);
  let time = 1000000000000;
  await createOnlineSizeService({ ...options, filename, now: () => time, send: async () => steam('10') }).lookup('10');
  time += SIZE_CACHE_TTL + 1;
  const offline = createOnlineSizeService({ ...options, filename, now: () => time, send: async () => { throw new TypeError('offline'); } });
  const result = await offline.lookup('10');
  assert.equal(result.status, 'offline');
  assert.equal(result.size.bytes, 100 * GB);
  assert.equal(result.size.stale, true);
  assert.equal((await offline.getCached('10')).bytes, 100 * GB);
  const absent = createOnlineSizeService({ ...options, filename, now: () => time, send: async () => steam('10', {}) });
  assert.equal((await absent.lookup('10')).size.bytes, 100 * GB);
});
test('Steam throttling opens a cooldown; malformed, oversized and wrong-ID responses cannot become sizes', async () => {
  let calls = 0;
  const limited = createOnlineSizeService({ ...options, send: async () => { calls++; return new Response('', { status: 429 }); } });
  assert.equal((await limited.lookup('10')).status, 'offline');
  assert.equal((await limited.lookup('20')).status, 'offline');
  assert.equal(calls, 1);
  for (const response of [new Response('not json'), steam('10', storage(100), { steam_appid: 20 }), new Response('x'.repeat(MAX_SIZE_RESPONSE + 1)), new Response('{}', { headers: { 'content-length': String(MAX_SIZE_RESPONSE + 1) } })]) {
    const result = await createOnlineSizeService({ ...options, send: async () => response }).lookup('10');
    assert.equal(result.status, 'offline'); assert.equal(result.size, null);
  }
});
test('cache corruption is kept intact while fetched sizes remain usable in memory', async t => {
  const { filename } = await fixture(t);
  await mkdir(path.dirname(filename));
  for (const source of ['{broken', '{"version":1,"entries":{"windows:10":{"bytes":-1,"checkedAt":0}}}', 'x'.repeat(MAX_SIZE_RESPONSE + 1)]) {
    await writeFile(filename, source);
    const service = createOnlineSizeService({ ...options, filename, send: async () => steam('10') });
    const result = await service.lookup('10');
    assert.equal(result.size.bytes, 100 * GB);
    assert.equal(result.cacheSaved, false);
    assert.equal(await readFile(filename, 'utf8'), source);
  }
});
test('request start times are spaced and queue capacity is bounded', async () => {
  let time = 1000000000000, release;
  const starts = [];
  const paused = new Promise(resolve => { release = resolve; });
  const service = createOnlineSizeService({ interval: 2000, now: () => time, wait: async ms => { time += ms; }, send: async url => { starts.push(time); await paused; return steam(new URL(url).searchParams.get('appids')); } });
  const first = Array.from({ length: 6 }, (_, i) => service.lookup(String(i + 1)));
  assert.equal((await service.lookup('7')).status, 'busy');
  await setImmediate(); release(); await Promise.all(first);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 2000);
});
test('API allows only scoped uninstalled IDs and honours the display switch', async t => {
  const { root, filename } = await fixture(t);
  let networkCalls = 0;
  const displaySettingsFile = path.join(root, 'settings.json');
  const service = createOnlineSizeService({ ...options, filename, send: async url => { networkCalls++; const id = new URL(url).searchParams.get('appids'); return steam(id, storage(100), { short_description: `Description ${id}` }); } });
  const server = createApp({ displaySettingsFile, exclusionsFile: path.join(root, 'exclusions.json'), onlineSizes: service, scan: async () => ({ games: [{ id: '10', installed: false }, { id: '20', installed: true }], libraries: [] }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = { 'X-Randomizer': '1' }) => fetch(base + '/api/game-size', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  await fetch(base + '/api/games');
  assert.equal(networkCalls, 0, 'Library scans must not fetch the entire account from the internet');
  assert.equal((await post({ id: '10' }, {})).status, 403);
  assert.equal((await post({ id: '10' }, { 'X-Randomizer': '1', Origin: 'https://example.com' })).status, 403);
  assert.equal((await post({ id: '10' }, { 'X-Randomizer': '1', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ id: '20' })).status, 404);
  assert.equal((await post({ id: '30' })).status, 404);
  assert.equal((await post({ id: '10', url: 'https://example.com' })).status, 400);
  await createDisplayStore(displaySettingsFile).change({ key: 'showUninstalledSize', value: false });
  assert.equal((await post({ id: '10' }).then(r => r.json())).status, 'disabled');
  assert.equal(networkCalls, 0);
  await createDisplayStore(displaySettingsFile).change({ key: 'showUninstalledSize', value: true });
  assert.equal((await post({ id: '10' }).then(r => r.json())).size.bytes, 100 * GB);
  assert.equal(networkCalls, 1);
  const description = (body, headers = { 'X-Randomizer': '1' }) => fetch(base + '/api/game-description', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await description({ id: '20', language: 'en' }).then(r => r.json())).description, 'Description 20');
  assert.equal(networkCalls, 2);
  assert.equal((await description({ id: '30', language: 'en' })).status, 404);
  assert.equal((await description({ id: '20', language: 'uk' })).status, 400);
  assert.equal((await description({ id: '20', language: 'en' }, {})).status, 403);
  assert.equal((await fetch(base + '/data/online-sizes.json')).status, 404);
  assert.equal((await fetch(base + '/online-sizes.js')).status, 200);
  assert.equal((await fetch(base + '/descriptions.js')).status, 200);
});
test('client limits requests, prioritizes the hero, clears hidden cards and deduplicates rerenders', async () => {
  const calls = [], completions = [], updates = [];
  const client = createOnlineSizesClient({ send: async (url, options) => {
    assert.equal(url, '/api/game-size'); assert.equal(options.headers['X-Randomizer'], '1');
    const id = JSON.parse(options.body).id; calls.push(id);
    return new Promise(resolve => completions.push(() => resolve(new Response(JSON.stringify({ status: 'not-found', size: null })))));
  }, onUpdate: (id, result) => updates.push({ id, result }) });
  for (const id of ['10', '20', '30', '40']) client.request(id);
  client.request('10'); client.request('40', true);
  assert.deepEqual(calls, ['10', '20']);
  completions.shift()(); await setImmediate();
  assert.deepEqual(calls, ['10', '20', '40']);
  client.clearQueue();
  while (completions.length) completions.shift()();
  await setImmediate();
  assert.equal(client.get('30'), undefined);
  assert.equal(updates.length, 3);
  client.request('10'); assert.equal(calls.length, 3);
});
test('client rejects malicious source links and exposes nonblocking offline status', async () => {
  let done;
  const completed = new Promise(resolve => { done = resolve; });
  const client = createOnlineSizesClient({ send: async () => new Response(JSON.stringify({ status: 'ready', size: { bytes: GB, kind: 'required-space', source: 'steam-store', sourceUrl: 'javascript:alert(1)', platform: 'windows', checkedAt: Date.now() } })), onUpdate: done });
  client.request('10'); const result = await completed;
  assert.equal(client.get('10').status, 'offline');
  assert.equal(client.get('10').size, null);
  client.retryUnavailable(); assert.equal(client.get('10'), undefined);
});
test('description client requests only a scoped ID and validates returned text', async () => {
  let complete;
  const updated = new Promise(resolve => { complete = resolve; });
  const client = createDescriptionsClient({ send: async (url, options) => {
    assert.equal(url, '/api/game-description');
    assert.deepEqual(JSON.parse(options.body), { id: '10', language: 'ru' });
    return new Response(JSON.stringify({ status: 'ready', description: 'Небольшое описание.', sourceUrl: 'https://store.steampowered.com/app/10/', language: 'russian', checkedAt: Date.now() }));
  }, onUpdate: complete });
  client.request('10', 'ru');
  await updated;
  assert.equal(client.get('10', 'ru').description, 'Небольшое описание.');
});
test('visible size prefers Steam requirements, distinguishes them from estimates and shows source/date', () => {
  const game = { id: '10', installed: false, installSize: { bytes: 12 * GB }, onlineSize: { bytes: 100 * GB, kind: 'required-space', source: 'steam-store', platform: 'windows', checkedAt: 1700000000000, stale: true } };
  assert.equal(uninstalledSize(game), 'Место: 100 ГБ');
  assert.equal(sizeSourceUrl(game), 'https://store.steampowered.com/app/10/');
  assert.match(sizeDescription(game), /не точный объём/);
  assert.match(sizeDescription(game), /обновить сейчас не удалось/);
  assert.equal(heroBadges(game).status, 'Не установлена');
  assert.equal(heroBadges(game).size, 'Место: 100 ГБ');
  assert.equal(heroBadges(game, { showUninstalledSize: false }).size, '');
  game.onlineSize = null;
  assert.equal(uninstalledSize(game), '≈ 12 ГБ');
  game.installSize.bytes = null; game.onlineSizeStatus = 'loading';
  assert.equal(uninstalledSize(game), 'Проверяем размер…');
  game.onlineSizeStatus = 'offline'; assert.match(sizeDescription(game), /недоступен/);
});
