import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAppSettingsStore } from '../lib/app-settings.mjs';
import { startupUpdateAction } from '../public/app-settings.js';

test('automatic updates are opt-in and saved outside release files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-app-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/app-settings.json');
  const store = createAppSettingsStore(filename);
  assert.deepEqual(await store.read(), { automaticUpdates: false, showUpdateNotifications: true });
  assert.deepEqual(await store.change({ key: 'automaticUpdates', value: true }), { automaticUpdates: true, showUpdateNotifications: true });
  assert.deepEqual(await createAppSettingsStore(filename).read(), { automaticUpdates: true, showUpdateNotifications: true });
  assert.match(await readFile(filename, 'utf8'), /"automaticUpdates":true/);
});

test('existing update preference migrates without losing the user choice', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-app-settings-v1-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/app-settings.json');
  await mkdir(path.dirname(filename));
  await writeFile(filename, JSON.stringify({ version: 1, settings: { automaticUpdates: true } }));
  const store = createAppSettingsStore(filename);
  assert.deepEqual(await store.read(), { automaticUpdates: true, showUpdateNotifications: true });
  await store.change({ key: 'showUpdateNotifications', value: false });
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), { version: 2, settings: { automaticUpdates: true, showUpdateNotifications: false } });
});

test('invalid app settings are preserved instead of overwritten', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-app-settings-bad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'data/app-settings.json');
  await mkdir(path.dirname(filename)); await writeFile(filename, '{bad');
  await assert.rejects(createAppSettingsStore(filename).read(), { status: 503 });
  assert.equal(await readFile(filename, 'utf8'), '{bad');
});

test('startup updates install only when opted in, otherwise show an optional notice', () => {
  const update = { status: 'ready', updateAvailable: true, installable: true };
  assert.equal(startupUpdateAction({ automaticUpdates: true, showUpdateNotifications: true }, update), 'install');
  assert.equal(startupUpdateAction({ automaticUpdates: false, showUpdateNotifications: true }, update), 'notify');
  assert.equal(startupUpdateAction({ automaticUpdates: false, showUpdateNotifications: false }, update), 'none');
  assert.equal(startupUpdateAction({ automaticUpdates: true, showUpdateNotifications: true }, { ...update, updateAvailable: false }), 'none');
});
