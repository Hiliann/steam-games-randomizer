import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {packageCache,appCache,licenseCache,steamId} from '../fixtures/steam-cache.mjs';
import { decodeLicenseCache, parseLicenses, ownedPackageIds, parsePackageInfo, parseAppInfo } from '../lib/steam-cache.mjs';
import { accountCandidates, scanOwnedLibrary } from '../lib/owned.mjs';
import { scanSteam, parseVdf } from '../lib/steam.mjs';


test('packageinfo old and current versions expose only requested package AppIDs', () => {
  for (const version of [0x06565527, 0x06565528]) {
    const result = parsePackageInfo(packageCache([[1, [10, 20]], [2, [30]]], version), new Set(['1']));
    assert.deepEqual([...result], [['1', ['10', '20']]]);
  }
});

test('appinfo versions 27-29 resolve Unicode names, types and string tables', () => {
  for (const version of [0x07564427, 0x07564428, 0x07564429]) {
    const result = parseAppInfo(appCache([[10, 'Игра 日本語'], [20, 'DLC', 'DLC'], [30, 'Unowned']], version), new Set(['10', '20']));
    assert.equal(result.get('10').name, 'Игра 日本語');
    assert.equal(result.get('20').type, 'dlc');
    assert.equal(result.has('30'), false);
  }
});

test('cache readers retain public size metadata and only licensed package depot IDs', () => {
  const ownedDepots = new Set();
  parsePackageInfo(packageCache([[1, [10], [101, 102]], [2, [20], [201]]]), new Set(['1']), { ownedDepots });
  assert.deepEqual([...ownedDepots], ['101', '102']);
  for (const version of [0x07564427, 0x07564428, 0x07564429]) {
    const depots = { 101: { manifests: { public: { size: '6000000000', download: '3000000000' } } } };
    assert.equal(parseAppInfo(appCache([[10, 'Game', 'Game', depots]], version)).get('10').depots['101'].manifests.public.size, '6000000000');
  }
});

test('binary cache readers reject truncation, unknown formats and invalid tables', () => {
  const apps = appCache([[10, 'Game']]);
  const packages = packageCache([[1, [10]]]);
  for (const [reader, bytes] of [[parseAppInfo, apps], [parsePackageInfo, packages]]) {
    for (const length of [0, 4, 8, bytes.length - 1]) assert.throws(() => reader(bytes.subarray(0, length)));
    const wrong = Buffer.from(bytes); wrong.writeUInt32LE(0, 0); assert.throws(() => reader(wrong));
  }
  const wrongOffset = Buffer.from(apps); wrongOffset.writeBigUInt64LE(0xffffffffffffffffn, 8);
  assert.throws(() => parseAppInfo(wrongOffset));
  const wrongSize = Buffer.from(apps); wrongSize.writeUInt32LE(0xffffffff, 20);
  assert.throws(() => parseAppInfo(wrongSize));
});

test('licensecache checksum and account seed prevent wrong-account or corrupted ownership', () => {
  const bytes = licenseCache([{ id: 5 }, { id: 6, flags: 8 }]);
  assert.deepEqual(parseLicenses(bytes, 123), [
    { packageId: '5', flags: 0, owner: 123, type: 1 },
    { packageId: '6', flags: 8, owner: 123, type: 1 },
  ]);
  assert.throws(() => parseLicenses(bytes, 124));
  const corrupted = Buffer.from(bytes); corrupted[5] ^= 1;
  assert.throws(() => parseLicenses(corrupted, 123));
  assert.throws(() => parseLicenses(Buffer.alloc(4), 123));
  assert.throws(() => decodeLicenseCache(bytes, -1));
  assert.equal(parseLicenses(licenseCache([{ id: 7 }], 3000000000), 3000000000)[0].packageId, '7');
});

test('ownership excludes expired, borrowed, revoked, pending and temporary licenses', () => {
  const invalidFlags = [2, 4, 8, 16, 32, 0x400, 0x800, 0x2000, 0x4000, 0x40000, 0x80000];
  const licenses = parseLicenses(licenseCache([
    { id: 1 }, { id: 2, owner: 999 }, { id: 3, type: 0 }, { id: 4, flags: 0x40 },
    ...invalidFlags.map((flags, i) => ({ id: 100 + i, flags })),
  ]), 123);
  assert.deepEqual([...ownedPackageIds(licenses, 123)], ['1', '4']);
});

test('account candidates retain only public display and selection fields', () => {
  const login = { users: {
    [steamId(3000000000)]: { PersonaName: 'Player', AccountName: 'private-login', Timestamp: '12', RememberPassword: '1', MostRecent: '1' },
    '../secret': {}, '76561197960265727': {},
  } };
  const candidates = accountCandidates(login, 'root');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].accountId, 3000000000);
  assert.equal(candidates[0].recent, true);
  assert.doesNotMatch(JSON.stringify(candidates), /private-login|RememberPassword/);
});

async function fixture(t, { missing = false, corrupt = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'playnext-owned-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, contents) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); };
  await put('config/loginusers.vdf', `"users" { "${steamId(123)}" { "PersonaName" "First player" "Timestamp" "10" } "${steamId(124)}" { "PersonaName" "Second player" "Timestamp" "20" } }`);
  await put('userdata/123/config/licensecache', corrupt ? Buffer.from('corrupt cache') : licenseCache([{ id: 1 }, ...(missing ? [{ id: 88 }] : [])]));
  await put('userdata/124/config/licensecache', licenseCache([{ id: 2 }], 124));
  await put('appcache/packageinfo.vdf', packageCache([[1, [10, 20, 40, 50, 60, ...(missing ? [99] : [])], [201]], [2, [30]]]));
  await put('appcache/appinfo.vdf', appCache([[10, 'Installed'], [20, 'Owned game', 'Game', { 201: { manifests: { public: { size: '6000000000' } } } }], [30, 'Other account game'], [40, 'Expansion', 'DLC'], [50, 'Editor', 'Tool'], [60, 'Demo', 'Demo'], [70, 'Viewed in store']]));
  await put('steamapps/appmanifest_10.acf', '"AppState" { "appid" "10" "name" "Installed" "StateFlags" "4" "installdir" "Installed" "SizeOnDisk" "1024" }');
  await put('steamapps/common/Installed/game.txt', 'fixture');
  return root;
}

test('active account is preferred, offline fallback uses latest account, caches do not imply ownership', async t => {
  const root = await fixture(t);
  const first = await scanOwnedLibrary([root], parseVdf, { activeUser: 123 });
  assert.deepEqual(first.games.map(game => game.id), ['10', '20']);
  assert.equal(first.info.status, 'ready');
  const second = await scanOwnedLibrary([root], parseVdf, { activeUser: 0 });
  assert.deepEqual(second.games.map(game => game.id), ['30']);
  const unknown = await scanOwnedLibrary([root], parseVdf, { activeUser: 125 });
  assert.equal(unknown.info.status, 'unavailable');
  assert.deepEqual(unknown.games, []);
});

test('missing metadata is visibly partial; unreadable licenses do not fall back to another account', async t => {
  const partial = await scanOwnedLibrary([await fixture(t, { missing: true })], parseVdf, { activeUser: 123 });
  assert.equal(partial.info.status, 'partial');
  assert.deepEqual(partial.games.map(game => game.id), ['10', '20']);
  const corrupt = await scanOwnedLibrary([await fixture(t, { corrupt: true })], parseVdf, { activeUser: 123 });
  assert.equal(corrupt.info.status, 'unavailable');
  assert.deepEqual(corrupt.games, []);
});

test('installed-only scan stays the default and adding owned games never duplicates installations', async t => {
  const root = await fixture(t);
  // Single-account fixture makes the offline choice independent of this PC.
  await writeFile(path.join(root, 'config/loginusers.vdf'), `"users" { "${steamId(123)}" { "Timestamp" "10" } }`);
  const installed = await scanSteam({ candidates: [root], ownedScan: () => { throw new Error('Must not read licenses when unchecked'); } });
  assert.equal(installed.ownedLibrary.status, 'not-requested');
  assert.equal(installed.games.length, 1);
  assert.equal(installed.games[0].installed, true);
  assert.equal(installed.installedCount, 1);
  const expanded = await scanSteam({ candidates: [root], includeUninstalled: true, ownedScan: (roots, parse) => scanOwnedLibrary(roots, parse, { activeUser: 123 }) });
  assert.deepEqual(expanded.games.map(game => game.id), ['10', '20']);
  assert.equal(expanded.games[0].installed, true);
  assert.equal(expanded.games[0].size, 1024);
  assert.equal(expanded.games[1].installed, false);
  assert.equal(expanded.games[1].installSize.bytes, 6000000000);
  assert.equal(expanded.games[1].installSize.estimated, true);
  assert.equal(expanded.games[1].depots, undefined, 'Raw depot metadata stays internal');
  assert.equal(expanded.installedCount, 1);
  assert.equal(expanded.ownedLibrary.addedCount, 1);
  const unavailable = await scanSteam({ candidates: [root], includeUninstalled: true, ownedScan: (roots, parse) => scanOwnedLibrary(roots, parse, { activeUser: 999 }) });
  assert.equal(unavailable.games.length, 1);
  assert.equal(unavailable.ownedLibrary.status, 'unavailable');
});
