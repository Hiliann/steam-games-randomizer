import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp, APP_VERSION, getInstanceId } from '../server.mjs';

async function fixture(t, options = {}) {
  const requests = [];
  const server = createApp({ scan: async options => {
    requests.push(options);
    return { games: [{ id: '10', name: '<script>Untrusted game name</script>' }], libraries: [], warnings: [], cacheRoots: ['private-cache-path'], skipped: 0, utilities: 0 };
  }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${port}`, port, requests };
}
test('local health, page and scripts are served with restrictive security headers', async t => {
  const { url } = await fixture(t);
  const health = await fetch(url + '/api/health').then(response => response.json());
  assert.equal(health.app, 'steam-games-randomizer');
  assert.equal(health.version, APP_VERSION);
  assert.match(health.instanceId, /^[0-9a-f]{24}$/);
  assert.equal(health.processId, process.pid);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.match(await page.text(), /Play Next/);
  for (const asset of ['/app.js', '/randomizer.js', '/ui-settings.js', '/i18n.js', '/backup.js']) {
    const response = await fetch(url + asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  const styles = await fetch(url + '/responsive.css');
  assert.equal(styles.status, 200);
  assert.match(styles.headers.get('content-type'), /text\/css/);
  assert.equal(styles.headers.get('cache-control'), 'no-cache');
});

test('application copy identity is stable, private and different for distinct folders', async () => {
  assert.equal(getInstanceId(), getInstanceId());
  assert.notEqual(getInstanceId('/first-copy'), getInstanceId('/second-copy'));
  assert.match(getInstanceId('/private-user-path'), /^[0-9a-f]{24}$/);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.version, APP_VERSION);
});
test('game scan cache omits internal cache roots from API results', async t => {
  const { url, requests } = await fixture(t);
  const result = await fetch(url + '/api/games').then(response => response.json());
  await fetch(url + '/api/games');
  assert.equal(result.games.length, 1);
  assert.equal('cacheRoots' in result, false);
  assert.equal(requests.length, 1);
});
test('same-origin scans require app header and validate body', async t => {
  const { url } = await fixture(t);
  const post = (body, headers = {}) => fetch(url + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('{"paths":[]}')).status, 403);
  assert.equal((await post('{"paths":[]}', { 'X-Randomizer': '1' })).status, 200);
  for (const body of ['null', '{}', '{"paths":["../secret"]}', '{"paths":["//server/share"]}', '{"paths":null}', '{"paths":[],"includeUninstalled":"true"}', '{"paths":[],"includeUninstalled":null}']) {
    assert.equal((await post(body, { 'X-Randomizer': '1' })).status, 400);
  }
  assert.equal((await post('invalid JSON', { 'X-Randomizer': '1' })).status, 400);
  assert.equal((await post('x'.repeat(40000), { 'X-Randomizer': '1' })).status, 413);
});

test('owned-library mode is opt-in and forwarded as a boolean', async t => {
  const { url, requests } = await fixture(t);
  const post = mode => fetch(url + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths: [], includeUninstalled: mode }) });
  await post(undefined); await post(true); await post(false);
  assert.deepEqual(requests.map(request => request.includeUninstalled), [false, true, false]);
});
test('Windows and update actions are bounded, same-origin and require the app header', async t => {
  const changes = [];
  const checks = [];
  const windowsIntegration = {
    read: async () => ({ supported: true, desktopShortcut: false, startup: false }),
    change: async body => { changes.push(body); return { supported: true, desktopShortcut: body.setting === 'desktopShortcut' && body.enabled, startup: body.setting === 'startup' && body.enabled }; },
  };
  const updates = {
    read: () => ({ status: 'not-checked', currentVersion: APP_VERSION }),
    check: async body => { checks.push(body); return { status: 'ready', currentVersion: APP_VERSION, latestVersion: APP_VERSION, updateAvailable: false, releaseUrl: 'https://github.com/Hiliann/steam-games-randomizer/releases/tag/v' + APP_VERSION }; },
  };
  const { url } = await fixture(t, { windowsIntegration, updates });
  assert.equal((await fetch(url + '/api/windows-settings')).status, 200);
  assert.equal((await fetch(url + '/api/update')).status, 200);
  const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('/api/windows-settings', JSON.stringify({ setting: 'startup', enabled: true }))).status, 403);
  assert.equal((await post('/api/update', JSON.stringify({ force: false }))).status, 403);
  assert.equal((await post('/api/windows-settings', JSON.stringify({ setting: 'startup', enabled: true }), { 'X-Randomizer': '1' })).status, 200);
  assert.equal((await post('/api/update', JSON.stringify({ force: true }), { 'X-Randomizer': '1' })).status, 200);
  assert.deepEqual(changes, [{ setting: 'startup', enabled: true }]);
  assert.deepEqual(checks, [{ force: true }]);
  for (const body of ['{}', '{"force":"yes"}', '{"force":false,"extra":1}']) assert.equal((await post('/api/update', body, { 'X-Randomizer': '1' })).status, 400);
});
test('game launch and update installation stay behind validated local APIs', async t => {
  const launches = [], installs = [];
  const version = '1.8.0';
  const updates = {
    read: () => ({
      status: 'ready', currentVersion: APP_VERSION, latestVersion: version, updateAvailable: true,
      releaseUrl: `https://github.com/Hiliann/steam-games-randomizer/releases/tag/v${version}`,
      downloadUrl: `https://github.com/Hiliann/steam-games-randomizer/releases/download/v${version}/PlayNext-${version}-win-x64.zip`,
      checksumUrl: `https://github.com/Hiliann/steam-games-randomizer/releases/download/v${version}/PlayNext-${version}-win-x64.zip.sha256`,
    }),
    check: async () => {},
  };
  const steamLauncher = { launch: async game => { launches.push(game.id); return { status: 'opened', action: 'run' }; } };
  const updateInstaller = { install: options => { installs.push(options); return { status: 'installing', targetVersion: options.version }; } };
  const { url, port } = await fixture(t, { steamLauncher, updateInstaller, updates });
  const post = (route, value, header = true) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(header ? { 'X-Randomizer': '1' } : {}) }, body: JSON.stringify(value) });
  assert.equal((await post('/api/launch', { id: '10' }, false)).status, 403);
  assert.equal((await post('/api/launch', { id: '10;calc' })).status, 400);
  assert.equal((await post('/api/launch', { id: '999' })).status, 404);
  assert.equal((await post('/api/launch', { id: '10' })).status, 200);
  assert.deepEqual(launches, ['10']);
  assert.equal((await post('/api/update-install', { version: '9.9.9' })).status, 409);
  assert.equal((await post('/api/update-install', { version })).status, 202);
  assert.equal(installs.length, 1);
  assert.equal(installs[0].port, port);
  assert.equal(installs[0].processId, process.pid);
});
test('cross-site requests, DNS rebinding and filesystem paths are rejected', async t => {
  const { url, port } = await fixture(t);
  assert.equal((await fetch(url + '/api/games', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(url + '/api/games', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/games', headers: { Host: 'attacker.example:' + port } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(status, 403);
  for (const target of ['/server.mjs', '/lib/steam.mjs', '/%2e%2e/package.json', '/art/..%2fsecret/hero']) assert.equal((await fetch(url + target)).status, 404);
});
test('missing artwork and unknown IDs are handled without arbitrary reads', async t => {
  const { url } = await fixture(t);
  await fetch(url + '/api/games');
  assert.equal((await fetch(url + '/art/999/hero')).status, 404);
  assert.equal((await fetch(url + '/art/10/hero')).status, 204);
});
test('static interface IDs match all script bindings without duplicates', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of script.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `Missing element: ${match[1]}`);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});
