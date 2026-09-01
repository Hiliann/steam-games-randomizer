import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { getInstanceId, APP_VERSION } from '../server.mjs';
import { createExclusionsClient } from '../public/exclusions.js';
import { createDisplayClient, DISPLAY_DEFAULTS } from '../public/display.js';
import { createProfileClient } from '../public/profile.js';

const execFileAsync = promisify(execFile);
const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass a clean, extracted application directory.');
const recordPath = path.join(directory, '.server-process.json');
const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
const powershell = path.join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const cleanEnvironment = { ...process.env };
for (const key of Object.keys(cleanEnvironment)) {
  if (['PATH', 'NODE_OPTIONS', 'NODE_PATH', 'STEAM_PATH', 'PORT'].includes(key.toUpperCase())) delete cleanEnvironment[key];
}
cleanEnvironment.PATH = [path.join(root, 'System32'), path.join(root, 'System32/Wbem'), path.dirname(powershell)].join(';');
const readRecord = async () => JSON.parse((await readFile(recordPath, 'utf8')).replace(/^\uFEFF/, ''));
const invoke = async flags => {
  const result = await execFileAsync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'start.ps1'), ...flags], {
    cwd: os.tmpdir(), windowsHide: true, env: cleanEnvironment, timeout: 45000,
  });
  console.log(result.stdout.trim());
};

const occupied = http.createServer((request, response) => { response.writeHead(200); response.end('another application'); });
occupied.listen(0, '127.0.0.1');
await once(occupied, 'listening');
const blockedPort = occupied.address().port;
try {
  console.log('Testing a clean copy with a deliberately occupied preferred port and no Node.js on PATH.');
  await invoke(['-NoBrowser', '-Port', String(blockedPort)]);
  const record = await readRecord();
  assert.notEqual(record.port, blockedPort);
  assert.equal(record.instanceId, getInstanceId(directory));
  const base = `http://127.0.0.1:${record.port}`;
  const health = await fetch(base + '/api/health').then(response => response.json());
  assert.equal(health.version, APP_VERSION);
  assert.equal(health.instanceId, record.instanceId);
  for (const asset of ['/', '/app.js', '/exclusions.js', '/profile.js', '/display.js', '/online-sizes.js', '/system.js', '/responsive.css', '/style.css']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  const games = await fetch(base + '/api/games').then(response => response.json());
  const windowsSettings = await fetch(base + '/api/windows-settings').then(response => response.json());
  assert.equal(windowsSettings.supported, true);
  assert.equal(typeof windowsSettings.desktopShortcut, 'boolean');
  assert.equal(typeof windowsSettings.startup, 'boolean');
  const updateStatus = await fetch(base + '/api/update').then(response => response.json());
  assert.equal(updateStatus.currentVersion, APP_VERSION);
  assert.ok(['not-checked', 'ready', 'offline'].includes(updateStatus.status));
  assert.ok(Array.isArray(games.games));
  assert.equal(games.ownedLibrary.status, 'not-requested');
  const scanMode = async includeUninstalled => {
    const response = await fetch(base + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths: [], includeUninstalled }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const expanded = await scanMode(true);
  assert.ok(['ready', 'partial', 'unavailable'].includes(expanded.ownedLibrary.status));
  assert.equal(expanded.installedCount, games.installedCount);
  assert.equal(expanded.games.length, new Set(expanded.games.map(game => game.id)).size);
  assert.ok(expanded.games.length >= games.games.length);
  const uninstalled = expanded.games.find(game => game.installed === false);
  let onlineCheck = null;
  if (process.argv.includes('--online') && uninstalled) {
    const selected = expanded.games.find(game => game.installed === false && game.id === '2139460') ?? uninstalled;
    const response = await fetch(base + '/api/game-size', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ id: selected.id }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'ready', 'Online check needs a reachable Steam entry with storage requirements');
    assert.equal(result.size.kind, 'required-space');
    assert.ok(result.size.bytes > 0);
    const cached = await fetch(base + '/api/game-size', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ id: selected.id }) }).then(response => response.json());
    assert.equal(cached.cached, true);
    onlineCheck = { id: selected.id, bytes: result.size.bytes };
  }
  if (uninstalled) {
    assert.equal(uninstalled.installSize.estimated, true);
    assert.ok(uninstalled.installSize.bytes === null || uninstalled.installSize.bytes > 0);
    const art = await fetch(`${base}/art/${uninstalled.id}/cover`);
    assert.ok([200, 204].includes(art.status));
    await art.arrayBuffer();
  }
  const back = await scanMode(false);
  assert.equal(back.games.length, games.games.length);
  assert.ok(back.games.every(game => game.installed));
  await invoke(['-NoBrowser', '-Port', String(blockedPort)]);
  assert.equal((await readRecord()).processId, record.processId, 'A second launch must reuse the same process');
  const running = await execFileAsync(powershell, ['-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); (Get-Process -Id ${record.processId}).Path`], { windowsHide: true });
  assert.equal(running.stdout.trim().toLowerCase(), path.join(directory, 'runtime/node.exe').toLowerCase());
  const exclusions = createExclusionsClient((route, options) => fetch(base + route, options));
  const display = createDisplayClient((route, options) => fetch(base + route, options));
  const profileClient = createProfileClient((route, options) => fetch(base + route, options));
  assert.deepEqual(await display.load(), DISPLAY_DEFAULTS);
  await display.set('showUninstalledSize', false);
  await display.set('showInstalledBadge', true);
  assert.deepEqual(await exclusions.load(['900000001']), ['900000001']);
  assert.deepEqual(await exclusions.set('900000002', true), ['900000001', '900000002']);
  let savedProfile = await profileClient.load({ seen: ['900000003'], current: '900000003' });
  savedProfile = await profileClient.setCategory(savedProfile.revision, '900000003', 'favorite', true);
  savedProfile = await profileClient.replaceDraw(savedProfile.revision, { ...savedProfile.draw, mode: 'category:favorite', history: [{ id: '900000003', at: '2026-09-01T00:00:00.000Z' }] });
  await invoke(['-Stop']);
  await assert.rejects(fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) }));
  // A different address and an empty browser cache must still see the saved file.
  const secondPort = record.port < 65000 ? record.port + 17 : 33100;
  await invoke(['-NoBrowser', '-Port', String(secondPort)]);
  const restarted = await readRecord();
  assert.notEqual(restarted.port, record.port);
  assert.notEqual(restarted.processId, record.processId);
  const restartedBase = `http://127.0.0.1:${restarted.port}`;
  const freshBrowser = createExclusionsClient((route, options) => fetch(restartedBase + route, options));
  const freshDisplay = createDisplayClient((route, options) => fetch(restartedBase + route, options));
  const freshProfile = createProfileClient((route, options) => fetch(restartedBase + route, options));
  if (onlineCheck) {
    const response = await fetch(restartedBase + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths: [], includeUninstalled: true }) });
    const loaded = await response.json();
    assert.equal(loaded.games.find(game => game.id === onlineCheck.id).onlineSize.bytes, onlineCheck.bytes, 'Restart loads cached internet size without a new network lookup');
    const disabled = await fetch(restartedBase + '/api/game-size', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ id: onlineCheck.id }) }).then(response => response.json());
    assert.equal(disabled.status, 'disabled');
  }
  assert.deepEqual(await freshDisplay.load(), { showUninstalledSize: false, showInstalledBadge: true });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'data/display-settings.json'), 'utf8')).settings, { showUninstalledSize: false, showInstalledBadge: true });
  assert.deepEqual(await freshBrowser.load([]), ['900000001', '900000002']);
  const restoredProfile = await freshProfile.load({});
  assert.deepEqual(restoredProfile.assignments['900000003'], ['favorite']);
  assert.equal(restoredProfile.draw.mode, 'category:favorite');
  assert.deepEqual(restoredProfile.draw.history, [{ id: '900000003', at: '2026-09-01T00:00:00.000Z' }]);
  await freshBrowser.set('900000001', false);
  assert.deepEqual(await freshBrowser.load(['900000001']), ['900000002']);
  const saved = JSON.parse(await readFile(path.join(directory, 'data/exclusions.json'), 'utf8'));
  assert.deepEqual(saved.excluded, ['900000002']);
  await invoke(['-Stop']);
  await assert.rejects(fetch(restartedBase + '/api/health', { signal: AbortSignal.timeout(1500) }));
  assert.equal(await fetch(`http://127.0.0.1:${blockedPort}`).then(response => response.text()), 'another application');
  console.log(JSON.stringify({ applicationLaunch: 'passed', systemNodeRequired: false, occupiedPort: 'handled', sameProcessOnRelaunch: true, installedGames: games.games.length, includingUninstalled: expanded.games.length, estimatedSizes: expanded.games.filter(game => game.installed === false && game.installSize?.bytes > 0).length, onlineSizeAndPersistentCache: onlineCheck ? 'passed' : 'not requested', libraryStatus: expanded.ownedLibrary.status, switchingModes: 'passed', exclusionsSurviveRestartAndPortChange: true, categoriesAndHistorySurviveRestartAndPortChange: true, displaySettingsSurviveRestartAndPortChange: true, emptyBrowserStorage: 'handled', staleImport: 'ignored', cleanStop: true }, null, 2));
} finally {
  await invoke(['-Stop']).catch(() => {});
  occupied.closeAllConnections();
  await new Promise(resolve => occupied.close(resolve));
}
