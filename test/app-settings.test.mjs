import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAppSettingsStore } from '../lib/app-settings.mjs';

test('automatic updates are opt-in and saved outside release files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-app-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/app-settings.json');
  const store = createAppSettingsStore(filename);
  assert.deepEqual(await store.read(), { automaticUpdates: false });
  assert.deepEqual(await store.change({ key: 'automaticUpdates', value: true }), { automaticUpdates: true });
  assert.deepEqual(await createAppSettingsStore(filename).read(), { automaticUpdates: true });
  assert.match(await readFile(filename, 'utf8'), /"automaticUpdates":true/);
});

test('invalid app settings are preserved instead of overwritten', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-app-settings-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/app-settings.json');
  await mkdir(path.dirname(filename)); await writeFile(filename, '{bad');
  await assert.rejects(createAppSettingsStore(filename).read(), { status: 503 });
  assert.equal(await readFile(filename, 'utf8'), '{bad');
});
