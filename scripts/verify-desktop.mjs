import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { getInstanceId } from '../server.mjs';
import { createProfileClient } from '../public/profile.js';
import { createExclusionsClient } from '../public/exclusions.js';

const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || process.platform !== 'win32') throw new Error('Pass a clean extracted Windows release directory.');
await access(path.join(directory, 'release-manifest.json'));
try { await access(path.join(directory, 'data')); throw new Error('Use an unused copy, never your personal app folder.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, milliseconds = 45000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const result = await check().catch(() => null); if (result) return result; await delay(250); }
  throw new Error('Desktop lifecycle check timed out.');
}
const record = async () => JSON.parse((await readFile(path.join(directory, '.server-process.json'), 'utf8')).replace(/^\uFEFF/, ''));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PLAYNEXT_DESKTOP_OWNER' || key.toUpperCase() === 'PORT') delete environment[key];
const launch = () => spawn(path.join(directory, 'Play Next.exe'), ['--minimized'], { cwd: directory, env: environment, windowsHide: true, stdio: 'ignore' });
const host = launch();
let service;
try {
  service = await waitFor(async () => {
    const saved = await record();
    if (saved.desktopOwner !== host.pid) return false;
    const health = await fetch(`http://127.0.0.1:${saved.port}/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.json());
    assert.equal(health.instanceId, getInstanceId(directory));
    return health.desktopOwner === host.pid ? saved : false;
  });
  let base = `http://127.0.0.1:${service.port}`;
  const socket = net.createConnection({ host: '127.0.0.1', port: service.port });
  await once(socket, 'connect');
  socket.write(['GET /api/browser-session?id=desktopsmoke0001 HTTP/1.1', `Host: 127.0.0.1:${service.port}`, `Origin: ${base}`, 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: AAECAwQFBgcICQoLDA0ODw==', '', ''].join('\r\n'));
  const [upgrade] = await once(socket, 'data'); assert.match(upgrade.toString(), /101 Switching Protocols/);
  socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
  console.log('Checking a minimized native window beyond the browser shutdown grace period.');
  await delay(17000); assert.equal(alive(service.processId), true);
  await fetch(base + '/api/games').then(r => r.arrayBuffer());
  const client = createProfileClient((route, options) => fetch(base + route, options));
  let profile = await client.load({});
  profile = await client.setCategory(profile.revision, '900000123', 'favorite', true);
  const exclusions = createExclusionsClient((route, options) => fetch(base + route, options));
  await exclusions.load([]); await exclusions.set('900000124', true);
  const dataBefore = await Promise.all(['profile.json', 'exclusions.json'].map(name => readFile(path.join(directory, 'data', name), 'utf8')));
  const second = launch();
  await waitFor(async () => !alive(second.pid));
  assert.equal((await record()).desktopOwner, host.pid); assert.equal((await record()).processId, service.processId);
  console.log('Simulating an unexpected local-service crash. The window must restart it.');
  process.kill(service.processId);
  const previous = service.processId;
  service = await waitFor(async () => {
    const saved = await record();
    if (saved.processId === previous || saved.desktopOwner !== host.pid) return false;
    const health = await fetch(`http://127.0.0.1:${saved.port}/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.json());
    return health.desktopOwner === host.pid ? saved : false;
  });
  const dataAfter = await Promise.all(['profile.json', 'exclusions.json'].map(name => readFile(path.join(directory, 'data', name), 'utf8')));
  assert.deepEqual(dataAfter, dataBefore);
  console.log('Simulating an unexpected native-window termination. Its service must also stop.');
  host.kill();
  await waitFor(async () => !alive(service.processId), 10000);
  console.log(JSON.stringify({ nativeWindow: 'passed', minimizedIdle: 'passed', duplicateLaunch: 'passed', automaticServiceRecovery: 'passed', categoriesAndExclusionsPreserved: true, orphanServiceCleanup: 'passed' }, null, 2));
} finally {
  if (alive(host.pid)) host.kill();
  if (service && alive(service.processId)) { await delay(2500); if (alive(service.processId)) process.kill(service.processId); }
}
