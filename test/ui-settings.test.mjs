import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createUiSettingsStore } from '../lib/ui-settings.mjs';
import { UI_DEFAULTS, createRandomAccent, createUiSettingsClient, validCustomAccent, validUiSettings } from '../public/ui-settings.js';
import { setLanguage, translate } from '../public/i18n.js';

test('language, theme and accent have safe defaults and survive restart', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-ui-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/ui-settings.json');
  const store = createUiSettingsStore(filename);
  assert.deepEqual(await store.read(), UI_DEFAULTS);
  await store.change({ key: 'language', value: 'en' });
  await store.change({ key: 'theme', value: 'midnight' });
  await store.change({ key: 'accent', value: 'violet' });
  const palette = { base: '#60ddee', hover: '#91eaf4', contrast: '#10282b' };
  await store.change({ customAccent: palette });
  const expected = { language: 'en', theme: 'midnight', accent: 'custom', customAccent: palette };
  assert.deepEqual(await createUiSettingsStore(filename).read(), expected);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { version: 2, settings: expected });
});

test('old appearance settings migrate without losing the selected preset', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-ui-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'ui.json');
  await writeFile(filename, JSON.stringify({ version: 1, settings: { language: 'en', theme: 'graphite', accent: 'orange' } }));
  const store = createUiSettingsStore(filename);
  assert.deepEqual(await store.read(), { language: 'en', theme: 'graphite', accent: 'orange', customAccent: UI_DEFAULTS.customAccent });
  await store.change({ key: 'accent', value: 'blue' });
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).version, 2);
});

test('unknown appearance values and malformed replacements are rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-ui-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createUiSettingsStore(path.join(root, 'ui.json'));
  for (const body of [null, {}, { key: 'theme', value: 'light' }, { key: '__proto__', value: 'forest' }, { key: 'accent', value: 'lime', extra: true }, { customAccent: { base: '#ffffff', hover: 'red', contrast: '#000000' } }]) {
    await assert.rejects(store.change(body), { status: 400 });
  }
  await assert.rejects(store.replace({ language: 'en', theme: 'forest' }), { status: 400 });
  assert.equal(validUiSettings(UI_DEFAULTS), true);
  assert.equal(validUiSettings({ language: 'ru', theme: 'forest', accent: 'lime' }), false);
});

test('random accent palettes stay editable and use valid web colors', () => {
  const palette = createRandomAccent(() => 0.5);
  assert.equal(validCustomAccent(palette), true);
  assert.notEqual(palette.base, palette.hover);
  assert.notEqual(palette.base, palette.contrast);
});

test('UI client protects writes and the English translator covers static and counted labels', async () => {
  let options;
  const client = createUiSettingsClient(async (url, value) => {
    assert.equal(url, '/api/ui-settings'); options = value;
    return { ok: true, json: async () => ({ ...UI_DEFAULTS, language: 'en', theme: 'graphite', accent: 'blue' }) };
  });
  await client.set('accent', 'blue');
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { key: 'accent', value: 'blue' });
  await client.saveCustomAccent({ base: '#abcdef', hover: '#bcdefa', contrast: '#123456' });
  assert.deepEqual(JSON.parse(options.body), { customAccent: { base: '#abcdef', hover: '#bcdefa', contrast: '#123456' } });
  setLanguage('en');
  assert.equal(translate('Настройки'), 'Settings');
  assert.equal(translate('Показано 4 из 20 игр'), 'Showing 4 of 20 games');
  setLanguage('ru');
});
