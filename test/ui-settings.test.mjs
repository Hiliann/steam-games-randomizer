import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createUiSettingsStore } from '../lib/ui-settings.mjs';
import { UI_DEFAULTS, createUiSettingsClient, validUiSettings } from '../public/ui-settings.js';
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
  const expected = { language: 'en', theme: 'midnight', accent: 'violet' };
  assert.deepEqual(await createUiSettingsStore(filename).read(), expected);
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { version: 1, settings: expected });
});

test('unknown appearance values and malformed replacements are rejected', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-ui-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createUiSettingsStore(path.join(root, 'ui.json'));
  for (const body of [null, {}, { key: 'theme', value: 'light' }, { key: '__proto__', value: 'forest' }, { key: 'accent', value: 'lime', extra: true }]) {
    await assert.rejects(store.change(body), { status: 400 });
  }
  await assert.rejects(store.replace({ language: 'en', theme: 'forest' }), { status: 400 });
  assert.equal(validUiSettings({ language: 'ru', theme: 'forest', accent: 'lime' }), true);
});

test('UI client protects writes and the English translator covers static and counted labels', async () => {
  let options;
  const client = createUiSettingsClient(async (url, value) => {
    assert.equal(url, '/api/ui-settings'); options = value;
    return { ok: true, json: async () => ({ language: 'en', theme: 'graphite', accent: 'blue' }) };
  });
  await client.set('accent', 'blue');
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { key: 'accent', value: 'blue' });
  setLanguage('en');
  assert.equal(translate('Настройки'), 'Settings');
  assert.equal(translate('Показано 4 из 20 игр'), 'Showing 4 of 20 games');
  setLanguage('ru');
});
