import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateInstaller } from '../lib/update-installer.mjs';

test('installer accepts only matching GitHub release artifacts and runs once', () => {
  const calls = [];
  const installer = createUpdateInstaller({ platform: 'win32', scriptPath: 'apply.ps1', runner: (...args) => calls.push(args) });
  const options = {
    version: '1.8.0',
    downloadUrl: 'https://github.com/Hiliann/steam-games-randomizer/releases/download/v1.8.0/PlayNext-1.8.0-win-x64.zip',
    checksumUrl: 'https://github.com/Hiliann/steam-games-randomizer/releases/download/v1.8.0/PlayNext-1.8.0-win-x64.zip.sha256',
    processId: 42, port: 3210,
  };
  assert.deepEqual(installer.install(options), { status: 'installing', targetVersion: '1.8.0' });
  assert.equal(calls.length, 1);
  assert.throws(() => installer.install(options), { status: 409 });
  assert.throws(() => createUpdateInstaller({ platform: 'win32' }).install({ ...options, downloadUrl: 'https://example.com/file.zip' }), { status: 400 });
});
