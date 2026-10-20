import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { MAX_FILTER_PRESETS, PRESET_DEFAULTS, cleanPresetFilters, validatePresets, presetNameError, describePreset, sameFilters, isDefaultFilters } from '../public/filter-presets.js';
import { createProfileStore, validateProfile } from '../lib/profile.mjs';
import { createProfileClient } from '../public/profile.js';
import { createBackupService } from '../lib/backup.mjs';
import { createExclusionsStore } from '../lib/exclusions.mjs';
import { createDisplayStore } from '../lib/display-settings.mjs';
import { createAppSettingsStore } from '../lib/app-settings.mjs';
import { createUiSettingsStore } from '../lib/ui-settings.mjs';
import { createApp } from '../server.mjs';

const filters = (overrides = {}) => ({ ...PRESET_DEFAULTS, ...overrides });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-presets-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, 'data/profile.json');
}

test('preset filters accept only known values and trim the query', () => {
  assert.deepEqual(cleanPresetFilters(filters({ category: 'favorite', status: 'uninstalled', sort: 'size', query: '  souls ' })),
    { filter: 'included', category: 'favorite', status: 'uninstalled', sort: 'size', query: 'souls', genre: 'all', feature: 'all' });
  const { genre, feature, ...older } = filters();
  assert.deepEqual(cleanPresetFilters(older), filters(), 'presets saved before genres default to any genre and mode');
  assert.deepEqual(cleanPresetFilters(filters({ genre: '23', feature: 'coop' })), filters({ genre: '23', feature: 'coop' }));
  for (const bad of [null, [], filters({ filter: 'weighted' }), filters({ status: 'owned' }), filters({ sort: 'playtime' }),
    filters({ category: '../x' }), filters({ query: 'x'.repeat(101) }), filters({ query: 'a\u0000b' }), filters({ query: 5 }),
    filters({ genre: 'action' }), filters({ genre: '0' }), filters({ feature: 'pvp' })]) {
    assert.equal(cleanPresetFilters(bad), null);
  }
});

test('saved presets are validated strictly and survive a deleted category', () => {
  const categories = new Set(['favorite']);
  assert.deepEqual(validatePresets(undefined, categories), [], 'profiles from older versions have no presets');
  const saved = validatePresets([
    { id: 'preset-0123456789ab', name: '  Short   games ', filters: filters({ category: 'favorite' }) },
    { id: 'preset-0123456789ac', name: 'Gone', filters: filters({ category: 'deleted-one' }) },
  ], categories);
  assert.equal(saved[0].name, 'Short games');
  assert.equal(saved[1].filters.category, 'all');
  const one = { id: 'preset-0123456789ab', name: 'One', filters: filters() };
  for (const bad of [{}, [{ ...one, id: 'x' }], [one, { ...one, name: 'Two' }], [one, { ...one, id: 'preset-0123456789ad', name: 'ONE' }],
    [{ ...one, name: '' }], [{ ...one, filters: filters({ sort: 'random' }) }],
    Array.from({ length: MAX_FILTER_PRESETS + 1 }, (_, index) => ({ ...one, id: `preset-${String(index).padStart(12, '0')}`, name: `P${index}` }))]) {
    assert.throws(() => validatePresets(bad, categories));
  }
});

test('preset helpers compare, describe and reject unusable names', () => {
  assert.equal(isDefaultFilters(filters()), true);
  assert.equal(sameFilters(filters({ query: 'a' }), filters({ query: 'a' })), true);
  assert.equal(sameFilters(filters({ query: 'a' }), filters()), false);
  assert.match(describePreset(filters({ category: 'favorite', sort: 'recent' }), [{ id: 'favorite', name: 'Любимые' }]), /Любимые · по последнему запуску/);
  const presets = [{ id: 'preset-0123456789ab', name: 'Вечер', filters: filters() }];
  assert.ok(presetNameError('   ', presets));
  assert.ok(presetNameError('вечер', presets));
  assert.ok(presetNameError('Новый', Array.from({ length: MAX_FILTER_PRESETS }, (_, index) => ({ name: `P${index}` }))));
  assert.equal(presetNameError('Новый', presets), null);
});

test('profile store adds, deletes and repairs presets without touching other data', async t => {
  const store = createProfileStore(await fixture(t));
  let profile = await store.change({ action: 'initialize', draw: {} });
  assert.deepEqual(profile.presets, []);
  profile = await store.change({ action: 'set-category', revision: profile.revision, appId: '10', categoryId: 'favorite', assigned: true });
  profile = await store.change({ action: 'add-preset', revision: profile.revision, name: 'Favorites to install', filters: filters({ category: 'favorite', status: 'uninstalled' }) });
  assert.equal(profile.presets.length, 1);
  assert.match(profile.presets[0].id, /^preset-[a-f0-9]{12}$/);
  for (const body of [
    { name: 'favorites TO install', filters: filters() },
    { name: 'Unknown category', filters: filters({ category: 'missing' }) },
    { name: 'Broken', filters: filters({ sort: 'playtime' }) },
    { name: '', filters: filters() },
  ]) await assert.rejects(store.change({ action: 'add-preset', revision: profile.revision, ...body }), { status: 400 });
  await assert.rejects(store.change({ action: 'delete-preset', revision: profile.revision, id: 'preset-000000000000' }), { status: 400 });
  profile = await store.change({ action: 'delete-category', revision: profile.revision, id: 'favorite' });
  assert.equal(profile.presets[0].filters.category, 'all');
  assert.equal(profile.presets[0].filters.status, 'uninstalled');
  profile = await store.change({ action: 'delete-preset', revision: profile.revision, id: profile.presets[0].id });
  assert.deepEqual(profile.presets, []);
  assert.deepEqual((await store.read()).presets, []);
});

test('profiles and backups from older versions without presets still load', async t => {
  const filename = await fixture(t);
  const legacy = { version: 1, revision: 4, categories: [{ id: 'favorite', name: 'Любимые', color: 'gold' }], assignments: { '10': ['favorite'] }, draw: { mode: 'recent' } };
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(legacy));
  const profile = await createProfileStore(filename).read();
  assert.deepEqual(profile.presets, []);
  assert.equal(profile.draw.mode, 'recent');
  assert.deepEqual(validateProfile(legacy).assignments, legacy.assignments);
});

test('backups carry presets and older backups without them restore cleanly', async t => {
  const filename = await fixture(t), root = path.dirname(filename);
  const stores = {
    exclusions: createExclusionsStore(path.join(root, 'exclusions.json')), displaySettings: createDisplayStore(path.join(root, 'display.json')),
    appSettings: createAppSettingsStore(path.join(root, 'app.json')), uiSettings: createUiSettingsStore(path.join(root, 'ui.json')), profile: createProfileStore(filename),
  };
  const service = createBackupService({ ...stores, appVersion: '2.7.0' });
  let profile = await stores.profile.change({ action: 'initialize', draw: {} });
  profile = await stores.profile.change({ action: 'add-preset', revision: profile.revision, name: 'Big', filters: filters({ sort: 'size' }) });
  const backup = { ...(await service.export()), browser: { includeUninstalled: false, customPaths: [] } };
  assert.equal(service.preview(backup).presets, 1);
  const legacy = structuredClone(backup);
  delete legacy.data.profile.presets;
  assert.equal(service.preview(legacy).presets, 0);
  await service.restore(legacy);
  assert.deepEqual((await stores.profile.read()).presets, []);
  await service.restore(backup);
  assert.deepEqual((await stores.profile.read()).presets, profile.presets);
});

test('preset API round-trips through the validating client', async t => {
  const filename = await fixture(t);
  const app = createApp({ profileFile: filename, scan: async () => ({ games: [], libraries: [], warnings: [] }) });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const url = `http://127.0.0.1:${app.address().port}`;
  const client = createProfileClient((route, options) => fetch(url + route, options));
  let profile = await client.load({});
  profile = await client.addPreset(profile.revision, 'Recent', filters({ sort: 'recent', filter: 'all' }));
  assert.equal(profile.presets[0].name, 'Recent');
  assert.equal((await fetch(url + '/filter-presets.js')).status, 200);
  profile = await client.deletePreset(profile.revision, profile.presets[0].id);
  assert.deepEqual(profile.presets, []);
  const malformed = createProfileClient(async () => ({ ok: true, json: async () => ({ initialized: true, revision: 1, categories: [], assignments: {}, draw: {}, presets: [{ id: 'bad' }] }) }));
  await assert.rejects(malformed.load({}), /некорректные категории/);
});

test('preset bar is wired into the library and packaged with the release', async () => {
  const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const [html, app, css, build] = await Promise.all([read('public/index.html'), read('public/app.js'), read('public/desktop.css'), read('scripts/build-release.ps1')]);
  assert.ok(html.includes('id="filter-presets"'));
  assert.match(app, /createFilterPresetsView\(/);
  assert.match(app, /profileClient\.addPreset/);
  assert.match(app, /profileClient\.deletePreset/);
  assert.match(css, /\.filter-presets\s*\{/);
  assert.ok(build.includes("'public\\filter-presets.js'"));
});
