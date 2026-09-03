import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { MAX_BACKUP_BYTES } from '../lib/backup.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-settings-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = createApp({
    exclusionsFile: path.join(root, 'exclusions.json'), displaySettingsFile: path.join(root, 'display.json'),
    appSettingsFile: path.join(root, 'app.json'), uiSettingsFile: path.join(root, 'ui.json'), profileFile: path.join(root, 'profile.json'),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('appearance and backup APIs are local-only, bounded and restore a valid export', async t => {
  const url = await fixture(t);
  const headers = { 'Content-Type': 'application/json', 'X-Randomizer': '1' };
  const appearance = await fetch(url + '/api/ui-settings').then(response => response.json());
  assert.deepEqual(appearance, { language: 'ru', theme: 'forest', accent: 'lime' });
  const changed = await fetch(url + '/api/ui-settings', { method: 'POST', headers, body: JSON.stringify({ key: 'language', value: 'en' }) });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).language, 'en');

  const exportedResponse = await fetch(url + '/api/backup');
  assert.equal(exportedResponse.headers.get('cache-control'), 'no-store');
  const backup = await exportedResponse.json();
  backup.browser = { includeUninstalled: true, customPaths: ['D:\\SteamLibrary'] };
  assert.equal((await fetch(url + '/api/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) })).status, 403);
  const restored = await fetch(url + '/api/backup', { method: 'POST', headers, body: JSON.stringify(backup) });
  assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), { restored: true, browser: backup.browser });
  assert.equal((await fetch(url + '/api/backup', { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(url + '/api/backup', { method: 'POST', headers, body: 'x'.repeat(MAX_BACKUP_BYTES + 1) })).status, 413);
  for (const target of ['/data/ui-settings.json', '/data/profile.json', '/lib/backup.mjs']) assert.equal((await fetch(url + target)).status, 404);
});

test('release allowlist contains every module needed by appearance and backup features', async () => {
  const script = await import('node:fs/promises').then(fs => fs.readFile(new URL('../scripts/build-release.ps1', import.meta.url), 'utf8'));
  for (const file of ['lib\\ui-settings.mjs', 'lib\\backup.mjs', 'public\\ui-settings.js', 'public\\i18n.js', 'public\\backup.js']) assert.ok(script.includes(`'${file}'`), file);
});
