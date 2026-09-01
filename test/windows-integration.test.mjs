import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsIntegration } from '../lib/windows-integration.mjs';
import { createSystemClient, updateStatus } from '../public/system.js';

test('Windows integration is inert on unsupported systems', async () => {
  const service = createWindowsIntegration({ platform: 'linux', runner: async () => { throw new Error('must not run'); } });
  assert.deepEqual(await service.read(), { supported: false, desktopShortcut: false, startup: false });
});

test('Windows integration maps only known settings to fixed PowerShell actions', async () => {
  const actions = [];
  const service = createWindowsIntegration({ platform: 'win32', scriptPath: 'fixed-script.ps1', runner: async (script, action) => {
    assert.equal(script, 'fixed-script.ps1');
    actions.push(action);
    return { stdout: JSON.stringify({ supported: true, desktopShortcut: action === 'DesktopOn', startup: action === 'StartupOn' }) };
  } });
  await service.read();
  assert.equal((await service.change({ setting: 'desktopShortcut', enabled: true })).desktopShortcut, true);
  assert.equal((await service.change({ setting: 'startup', enabled: true })).startup, true);
  assert.deepEqual(actions, ['Status', 'DesktopOn', 'StartupOn']);
  assert.throws(() => service.change({ setting: '../file', enabled: true }), { status: 400 });
  assert.throws(() => service.change({ setting: 'startup', enabled: 'yes' }), { status: 400 });
});

test('browser client sends protected mutations and rejects forged update links', async () => {
  const calls = [];
  const client = createSystemClient(async (route, options = {}) => {
    calls.push({ route, options });
    if (route === '/api/windows-settings') return new Response(JSON.stringify({ supported: true, desktopShortcut: true, startup: false }));
    return new Response(JSON.stringify({ status: 'ready', currentVersion: '1.6.0', latestVersion: '1.7.0', updateAvailable: true, releaseUrl: 'javascript:alert(1)' }));
  });
  assert.equal((await client.loadWindows()).desktopShortcut, true);
  await client.setWindows('startup', true);
  assert.equal(JSON.parse(calls[1].options.body).setting, 'startup');
  assert.equal(calls[1].options.headers['X-Randomizer'], '1');
  assert.equal((await client.checkUpdate(true)).releaseUrl, null);
  assert.deepEqual(JSON.parse(calls[2].options.body), { force: true });
  assert.throws(() => updateStatus({ status: 'ready', currentVersion: '1.6.0' }), /некорректную версию/);
});
