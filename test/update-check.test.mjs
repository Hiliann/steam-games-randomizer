import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, createUpdateService, parseVersion } from '../lib/update-check.mjs';

test('semantic versions are parsed and compared without lexicographic mistakes', () => {
  assert.deepEqual(parseVersion('v1.10.2'), [1, 10, 2]);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.6.0', 'v1.6.0'), 0);
  assert.equal(compareVersions('1.5.9', '1.6.0'), -1);
});

test('update checker accepts only the expected public release and caches background checks', async () => {
  let requests = 0;
  let now = Date.parse('2026-09-01T12:00:00Z');
  const request = async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.github.com/repos/Hiliann/steam-games-randomizer/releases/latest');
    assert.match(options.headers['User-Agent'], /Play-Next\/1\.6\.0/);
    return new Response(JSON.stringify({
      tag_name: 'v1.7.0', draft: false, prerelease: false,
      assets: [{ name: 'PlayNext-1.7.0-win-x64.zip', browser_download_url: 'https://github.com/Hiliann/steam-games-randomizer/releases/download/v1.7.0/PlayNext-1.7.0-win-x64.zip' }],
    }));
  };
  const service = createUpdateService({ currentVersion: '1.6.0', request, clock: () => now });
  assert.deepEqual(service.read(), { status: 'not-checked', currentVersion: '1.6.0' });
  const first = await service.check();
  assert.equal(first.updateAvailable, true);
  assert.equal(first.latestVersion, '1.7.0');
  assert.match(first.releaseUrl, /releases\/tag\/v1\.7\.0$/);
  assert.match(first.downloadUrl, /PlayNext-1\.7\.0-win-x64\.zip$/);
  await service.check();
  assert.equal(requests, 1);
  now += 1000;
  await service.check({ force: true });
  assert.equal(requests, 2);
});

test('update checker reports an offline result for invalid or unreachable responses', async () => {
  const invalid = createUpdateService({ currentVersion: '1.6.0', request: async () => new Response(JSON.stringify({ tag_name: '../bad', assets: [] })) });
  assert.equal((await invalid.check()).status, 'offline');
  const unavailable = createUpdateService({ currentVersion: '1.6.0', request: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.check()).status, 'offline');
});
