import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createRequestGate } from '../lib/request-gate.mjs';
import { createStoreDetailsService, parseStoreDetails, STORE_UNAVAILABLE_RETRY } from '../lib/store-details.mjs';
import { cleanStoreEntry, createStoreDetailsClient, matchesFeature, matchesGenre, storeProgressText } from '../public/store-details.js';
import { cleanDrawState, matchesMode } from '../public/randomizer.js';
import { filterLibraryGames } from '../public/workspace.js';
import { createApp } from '../server.mjs';

const details = (id, { genres = [{ id: '1', description: 'Action' }], categories = [{ id: 2 }, { id: 38 }] } = {}) =>
  new Response(JSON.stringify({ [id]: { success: true, data: { genres, categories } } }), { headers: { 'content-type': 'application/json' } });
const missing = id => new Response(JSON.stringify({ [id]: { success: false } }), { headers: { 'content-type': 'application/json' } });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-store-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, 'data/store-details.json');
}
function clock() {
  const value = { time: 1_800_000_000_000 };
  value.gate = createRequestGate({ interval: 2000, now: () => value.time, wait: async ms => { value.time += ms; } });
  return value;
}
const on = async () => true;

test('Store genres and play modes are parsed only from confirmed fields', () => {
  const parsed = parseStoreDetails({ genres: [{ id: '1', description: 'Action' }, { id: 23, description: 'Indie' }, { id: 'x' }], categories: [{ id: 2 }, { id: 9 }] });
  assert.deepEqual(parsed.entry, { genres: ['1', '23'], features: { single: true, multi: true, coop: true } });
  assert.deepEqual(parsed.names, { 1: 'Action', 23: 'Indie' });
  assert.deepEqual(parseStoreDetails({ genres: [], categories: [{ id: 22 }] }).entry.features, { single: false, multi: false, coop: false });
  assert.equal(parseStoreDetails({ genres: [] }).entry.features, null, 'a missing category list keeps play modes unknown');
  assert.equal(cleanStoreEntry({ genres: ['1'], features: { single: true } }), null);
});

test('modes and library filters never guess unknown games', () => {
  const action = { id: '10', name: 'A', store: { genres: ['1'], features: { single: true, multi: false, coop: false } } };
  const noModes = { id: '20', name: 'B', store: { genres: ['23'], features: null } };
  const unknown = { id: '30', name: 'C', store: null };
  assert.equal(matchesMode(action, 'genre:1'), true);
  assert.equal(matchesMode(unknown, 'genre:1'), false);
  assert.equal(matchesMode(action, 'single'), true);
  assert.equal(matchesMode(noModes, 'single'), false);
  assert.equal(matchesMode(unknown, 'coop'), false);
  assert.equal(cleanDrawState({ mode: 'genre:23' }).mode, 'genre:23');
  for (const mode of ['genre:0', 'genre:abc', 'genre:12345', 'pvp']) assert.equal(cleanDrawState({ mode }).mode, 'all');
  const games = [action, noModes, unknown];
  assert.deepEqual(games.filter(game => matchesGenre(game, 'unknown')).map(game => game.id), ['30']);
  assert.deepEqual(games.filter(game => matchesFeature(game, 'unknown')).map(game => game.id), ['20', '30']);
  assert.deepEqual(filterLibraryGames(games, { genre: '23' }).map(game => game.id), ['20']);
  assert.deepEqual(filterLibraryGames(games, { feature: 'single' }).map(game => game.id), ['10']);
});

test('the whole library loads once, persists, and later only missing games are requested', async t => {
  const filename = await fixture(t);
  const requested = [];
  const send = async url => { const id = new URL(url).searchParams.get('appids'); requested.push(id); return id === '30' ? missing(id) : details(id); };
  const first = clock();
  const service = createStoreDetailsService({ filename, send, gate: first.gate });
  await service.schedule(['10', '20', '30'], on);
  assert.deepEqual(requested, ['10', '20', '30']);
  assert.deepEqual(service.progress(), { state: 'idle', total: 3, known: 2, unavailable: 1, pending: 0 });
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  assert.equal(saved.entries['10'].available, true);
  assert.equal(saved.entries['30'].available, false);
  assert.ok(!JSON.stringify(saved).includes('steampowered'), 'the cache stores no URLs');

  requested.length = 0;
  const later = clock(); later.time += 365 * 86400000;
  const restarted = createStoreDetailsService({ filename, send, gate: later.gate });
  await restarted.schedule(['10', '20', '30', '40'], on);
  assert.deepEqual(requested, ['30', '40'], 'confirmed entries never expire; a game missing from the Store is retried after a week');
  const read = await restarted.read(0);
  assert.deepEqual(Object.keys(read.entries).sort(), ['10', '20', '30', '40']);
  assert.equal(read.entries['30'], null);
  assert.equal(read.names['1'], 'Action');
  assert.deepEqual(Object.keys((await restarted.read(read.revision)).entries), []);
  assert.ok(STORE_UNAVAILABLE_RETRY >= 86400000);
});

test('the display switch stops the queue and failures are retried on the next refresh', async t => {
  const filename = await fixture(t);
  let calls = 0, fail = true;
  const send = async url => { calls++; const id = new URL(url).searchParams.get('appids'); if (fail && id === '20') return new Response('{}', { status: 500 }); return details(id); };
  const { gate } = clock();
  const service = createStoreDetailsService({ filename, send, gate });
  await service.schedule(['10', '20'], async () => false);
  assert.equal(calls, 0);
  assert.equal(service.progress().state, 'disabled');
  let allowed = 1;
  await service.schedule(['10', '20', '30'], async () => allowed-- > 0);
  assert.equal(calls, 1, 'turning the switch off stops before the next request');
  await service.schedule(['10', '20', '30'], on);
  assert.equal(service.progress().known, 2);
  assert.equal(service.progress().pending, 1, 'a failed request is not retried in a loop');
  fail = false;
  await service.schedule(['10', '20', '30'], on);
  assert.equal(service.progress().pending, 0);
});

test('Steam refusals pause the shared gate and foreground lookups go first', async t => {
  const filename = await fixture(t);
  const timeline = [];
  const state = clock();
  let busy = 2, refused = false;
  const send = async url => {
    const id = new URL(url).searchParams.get('appids');
    timeline.push([id, state.time]);
    if (!refused) { refused = true; return new Response('{}', { status: 429 }); }
    return details(id);
  };
  const service = createStoreDetailsService({ filename, send, gate: state.gate, isForegroundBusy: () => busy-- > 0 });
  await service.schedule(['10', '20'], on);
  assert.equal(timeline[0][0], '10');
  assert.ok(timeline[1][1] - timeline[0][1] >= 30 * 60000, 'a 429 pauses Store requests for 30 minutes');
  assert.deepEqual(service.progress(), { state: 'idle', total: 2, known: 1, unavailable: 0, pending: 1 });
});

test('a damaged cache is preserved and results stay in memory', async t => {
  const filename = await fixture(t);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, '{"version":1,"entries":{"10":{"available":true,"checkedAt":1,"genres":["x"]}}}');
  const service = createStoreDetailsService({ filename, send: async url => details(new URL(url).searchParams.get('appids')), gate: clock().gate });
  await service.schedule(['10'], on);
  assert.equal(service.progress().known, 1);
  assert.match(await readFile(filename, 'utf8'), /"x"/);
});

test('progress text and client validation', async () => {
  assert.match(storeProgressText({ state: 'loading', total: 850, known: 100, unavailable: 20, pending: 730 }), /120 из 850/);
  assert.match(storeProgressText({ state: 'disabled', total: 2, known: 0, unavailable: 0, pending: 2 }), /выключен переключатель «Размер неустановленных игр»/);
  assert.equal(storeProgressText({ state: 'idle', total: 2, known: 2, unavailable: 0, pending: 0 }), '');
  const reply = body => async () => ({ ok: true, json: async () => body });
  const progress = { state: 'idle', total: 1, known: 1, unavailable: 0, pending: 0 };
  const good = await createStoreDetailsClient(reply({ revision: 2, progress, entries: { 10: { genres: ['1'], features: null }, 20: null, bad: {} }, names: { 1: 'Action', 2: '<b>' } })).load();
  assert.deepEqual(good.entries, { 10: { genres: ['1'], features: null }, 20: null });
  assert.deepEqual(good.names, { 1: 'Action' });
  await assert.rejects(createStoreDetailsClient(reply({ revision: 1, progress: { state: 'weird' }, entries: {} })).load(), /некорректные жанры/);
});

test('the app schedules genres after a scan, follows the switch and reports counts only', async t => {
  const filename = await fixture(t), root = path.dirname(path.dirname(filename));
  const state = clock();
  const storeDetails = createStoreDetailsService({ filename, send: async url => details(new URL(url).searchParams.get('appids')), gate: state.gate });
  const app = createApp({ displaySettingsFile: path.join(root, 'display.json'), exclusionsFile: path.join(root, 'exclusions.json'), profileFile: path.join(root, 'profile.json'), storeDetails,
    scan: async () => ({ games: [{ id: '10', name: 'Ten', installed: true }, { id: '20', name: 'Twenty', installed: false }], libraries: [], warnings: [] }) });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const url = `http://127.0.0.1:${app.address().port}`;
  const post = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/scan', { paths: [] })).status, 200);
  const client = createStoreDetailsClient((route, options) => fetch(url + route, options));
  let result = await client.load();
  for (let i = 0; i < 50 && result.progress.state !== 'idle'; i++) { await new Promise(resolve => setTimeout(resolve, 10)); result = await client.load(); }
  assert.deepEqual(result.progress, { state: 'idle', total: 2, known: 2, unavailable: 0, pending: 0 });
  assert.deepEqual(result.entries['20'], { genres: ['1'], features: { single: true, multi: true, coop: true } });
  assert.equal(Object.keys((await (await fetch(url + '/api/store-details?since=-1')).json()).entries).length, 2, 'an invalid revision returns everything');
  assert.equal((await fetch(url + '/store-details.js')).status, 200);
  const report = await (await post('/api/diagnostics', {})).json();
  assert.equal(report.library.storeDetails, 'idle');
  assert.equal(report.library.storeDetailsKnown, 2);
  assert.ok(!JSON.stringify(report).includes('Action'), 'diagnostics contain counts, not genres');
  assert.equal((await post('/api/display-settings', { key: 'showUninstalledSize', value: false })).status, 200);
  assert.equal((await post('/api/scan', { paths: [] })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await client.load()).progress.state, 'disabled');
});
