import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createBackupService } from '../lib/backup.mjs';
import { createExclusionsStore } from '../lib/exclusions.mjs';
import { createDisplayStore } from '../lib/display-settings.mjs';
import { createAppSettingsStore } from '../lib/app-settings.mjs';
import { createUiSettingsStore } from '../lib/ui-settings.mjs';
import { createProfileStore } from '../lib/profile.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const exclusions = createExclusionsStore(path.join(root, 'exclusions.json'));
  const displaySettings = createDisplayStore(path.join(root, 'display.json'));
  const appSettings = createAppSettingsStore(path.join(root, 'app.json'));
  const uiSettings = createUiSettingsStore(path.join(root, 'ui.json'));
  const profile = createProfileStore(path.join(root, 'profile.json'));
  const service = createBackupService({ exclusions, displaySettings, appSettings, uiSettings, profile, appVersion: '1.8.0' });
  return { service, exclusions, displaySettings, appSettings, uiSettings, profile };
}

test('one backup restores categories, history, exclusions and all settings', async t => {
  const stores = await fixture(t);
  const profile = {
    version: 1, revision: 7,
    categories: [{ id: 'evening', name: 'На вечер', color: 'violet' }],
    assignments: { 10: ['evening'] },
    draw: { seen: ['10'], history: [{ id: '10', at: '2026-09-03T12:00:00.000Z' }], noRepeats: true, current: '10', mode: 'category:evening' },
  };
  await stores.exclusions.replace(['10', '20']);
  await stores.displaySettings.replace({ showUninstalledSize: false, showInstalledBadge: true });
  await stores.appSettings.replace({ automaticUpdates: true, showUpdateNotifications: false });
  await stores.uiSettings.replace({ language: 'en', theme: 'midnight', accent: 'blue' });
  await stores.profile.replace(profile);
  const backup = { ...(await stores.service.export()), browser: { includeUninstalled: true, customPaths: ['D:\\SteamLibrary'] } };

  await stores.exclusions.replace([]);
  await stores.displaySettings.replace({ showUninstalledSize: true, showInstalledBadge: false });
  await stores.appSettings.replace({ automaticUpdates: false, showUpdateNotifications: true });
  await stores.uiSettings.replace({ language: 'ru', theme: 'forest', accent: 'lime' });
  await stores.profile.replace({ ...profile, revision: 8, assignments: {}, draw: { ...profile.draw, seen: [], history: [], current: null, mode: 'all' } });

  assert.deepEqual(await stores.service.restore(backup), { restored: true, browser: backup.browser });
  assert.deepEqual((await stores.exclusions.read()).excluded, ['10', '20']);
  assert.deepEqual(await stores.displaySettings.read(), backup.data.displaySettings);
  assert.deepEqual(await stores.appSettings.read(), backup.data.appSettings);
  assert.deepEqual(await stores.uiSettings.read(), backup.data.uiSettings);
  const restoredProfile = await stores.profile.read();
  assert.deepEqual({ ...restoredProfile, initialized: undefined }, { ...profile, initialized: undefined });
});

test('damaged backup is rejected before any saved data changes', async t => {
  const stores = await fixture(t);
  await stores.exclusions.replace(['42']);
  const backup = { ...(await stores.service.export()), browser: { includeUninstalled: false, customPaths: [] } };
  backup.data.profile.assignments = { 42: ['missing-category'] };
  await assert.rejects(stores.service.restore(backup), { status: 400 });
  assert.deepEqual((await stores.exclusions.read()).excluded, ['42']);
});

test('restore rolls earlier stores back when a later write fails', async () => {
  let excluded = ['1'];
  let display = { showUninstalledSize: true, showInstalledBadge: false };
  let failOnce = true;
  const fixed = value => ({ read: async () => structuredClone(value), replace: async next => { Object.assign(value, structuredClone(next)); } });
  const exclusions = { read: async () => ({ initialized: true, excluded: [...excluded] }), replace: async next => { excluded = [...next]; } };
  const displaySettings = { read: async () => ({ ...display }), replace: async next => { display = { ...next }; } };
  const appSettings = fixed({ automaticUpdates: false, showUpdateNotifications: true });
  const uiSettings = { read: async () => ({ language: 'ru', theme: 'forest', accent: 'lime' }), replace: async () => { if (failOnce) { failOnce = false; throw new Error('disk full'); } } };
  const profile = { read: async () => ({ initialized: true, version: 1, revision: 1, categories: [], assignments: {}, draw: { seen: [], history: [], noRepeats: true, current: null, mode: 'all' } }), replace: async () => {} };
  const service = createBackupService({ exclusions, displaySettings, appSettings, uiSettings, profile, appVersion: '1.8.0' });
  const backup = await service.export();
  backup.browser = { includeUninstalled: false, customPaths: [] };
  backup.data.exclusions = ['2']; backup.data.displaySettings.showInstalledBadge = true;
  await assert.rejects(service.restore(backup), /Прежние данные возвращены/);
  assert.deepEqual(excluded, ['1']);
  assert.deepEqual(display, { showUninstalledSize: true, showInstalledBadge: false });
});
