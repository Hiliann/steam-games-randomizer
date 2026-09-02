import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamLauncher } from '../lib/steam-launch.mjs';

test('Steam launcher chooses a fixed local URI without browser navigation', async () => {
  const calls = [];
  const launcher = createSteamLauncher({ platform: 'win32', scriptPath: 'launch.ps1', runner: async (...args) => calls.push(args) });
  assert.deepEqual(await launcher.launch({ id: '10', installed: true }), { status: 'opened', action: 'run' });
  assert.deepEqual(await launcher.launch({ id: '20', installed: false }), { status: 'opened', action: 'install' });
  assert.deepEqual(calls, [['launch.ps1', 'steam://run/10'], ['launch.ps1', 'steam://install/20']]);
  await assert.rejects(launcher.launch({ id: '10;calc', installed: true }), { status: 400 });
});
