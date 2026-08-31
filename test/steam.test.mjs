import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseVdf, scanSteam, normalizeLibrary, findArtwork } from '../lib/steam.mjs';

const quote = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'steam-randomizer-test-'));
  // Cleanup is restricted to the unique test directory returned by mkdtemp.
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'steam-randomizer-test-')));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function library(root, name = 'Steam') {
  const location = path.join(root, name);
  await mkdir(path.join(location, 'steamapps/common'), { recursive: true });
  return location;
}
async function app(root, { id = '10', name = 'Test game', flags = '4', folder = `game-${id}`, files = true, size = '1234', lastPlayed = '0' } = {}) {
  const content = `"AppState" { "appid" ${quote(id)} "name" ${quote(name)} "StateFlags" ${quote(flags)} "installdir" ${quote(folder)} "SizeOnDisk" ${quote(size)} "LastPlayed" ${quote(lastPlayed)} }`;
  await writeFile(path.join(root, 'steamapps', `appmanifest_${id}.acf`), content);
  if (files && !folder.startsWith('..')) {
    await mkdir(path.join(root, 'steamapps/common', folder), { recursive: true });
    await writeFile(path.join(root, 'steamapps/common', folder, 'game.dat'), 'test installation');
  }
}

test('KeyValues parses nested maps, comments, escaped paths, unicode and quoted braces', () => {
  const vdf = '// comment\n"libraryfolders" { "0" { "path" "D:\\\\Steam" "name" "Игра \\"Да\\"" "brace" "}" } }';
  const result = parseVdf(vdf);
  assert.equal(result.libraryfolders['0'].path, 'D:\\Steam');
  assert.equal(result.libraryfolders['0'].name, 'Игра "Да"');
  assert.equal(result.libraryfolders['0'].brace, '}');
});
test('KeyValues rejects malformed input and protects object prototypes', () => {
  for (const source of ['"root" { "key" "value"', '"key"', '}', '{', '"unterminated']) assert.throws(() => parseVdf(source));
  const result = parseVdf('"__proto__" { "polluted" "yes" }');
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal({}.polluted, undefined);
});
test('library path validation rejects relative paths, network shares and nulls', () => {
  for (const invalid of ['', 'relative/steam', '\\\\server\\share', '//server/share', null, 'C:\0Steam']) assert.equal(normalizeLibrary(invalid), null);
  const absolute = path.join(os.tmpdir(), 'Steam');
  assert.equal(normalizeLibrary(path.join(absolute, 'steamapps')), absolute);
  assert.equal(normalizeLibrary(`"${absolute}"`), absolute);
});
test('scanner finds installed games across libraries and deduplicates AppIDs', async t => {
  const root = await fixture(t);
  const first = await library(root);
  const second = await library(root, 'Library Two');
  await writeFile(path.join(first, 'steamapps/libraryfolders.vdf'), `"libraryfolders" { "0" { "path" ${quote(first)} } "1" { "path" ${quote(second)} } }`);
  await app(first, { id: '10', name: 'Игра "тест"' });
  await app(second, { id: '20' });
  await app(second, { id: '10', name: 'Игра "тест"', lastPlayed: '100' });
  const result = await scanSteam({ candidates: [first] });
  assert.equal(result.games.length, 2);
  assert.equal(result.libraries.length, 2);
  assert.equal(result.games.find(game => game.id === '10').library, second);
  assert.equal(result.games.find(game => game.id === '10').name, 'Игра "тест"');
  assert.deepEqual(result.warnings, []);
});
test('scanner omits incomplete, missing, empty, escaping and utility installations', async t => {
  const root = await fixture(t);
  const steam = await library(root);
  await app(steam, { id: '1', flags: '1026' });
  await app(steam, { id: '2', files: false });
  await app(steam, { id: '3', folder: '../outside', files: false });
  await app(steam, { id: '4', files: false });
  await mkdir(path.join(steam, 'steamapps/common/game-4'));
  await app(steam, { id: '228980', name: 'Steamworks Common Redistributables' });
  await app(steam, { id: '250820', name: 'SteamVR' });
  await app(steam, { id: '5', flags: '6' });
  const result = await scanSteam({ candidates: [steam] });
  assert.deepEqual(result.games.map(game => game.id), ['5']);
  assert.equal(result.games[0].updateRequired, true);
  assert.equal(result.utilities, 2);
  assert.equal(result.skipped, 4);
});
test('old library format, malformed manifests and unavailable drives do not abort scanning', async t => {
  const root = await fixture(t);
  const first = await library(root);
  const second = await library(root, 'Older library');
  const missing = path.join(root, 'Disconnected');
  await writeFile(path.join(first, 'steamapps/libraryfolders.vdf'), `"LibraryFolders" { "1" ${quote(second)} "2" ${quote(missing)} }`);
  await writeFile(path.join(first, 'steamapps/appmanifest_404.acf'), 'broken');
  await app(second);
  const result = await scanSteam({ candidates: [first], customPaths: [path.join(root, 'Invalid')] });
  assert.equal(result.games.length, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.libraries.find(item => item.path === missing).available, false);
  assert.equal(result.warnings.length, 2);
});
test('custom steamapps paths work without scanning unrelated roots', async t => {
  const root = await fixture(t);
  const steam = await library(root);
  await app(steam);
  const result = await scanSteam({ candidates: [], customPaths: [path.join(steam, 'steamapps')] });
  assert.equal(result.games.length, 1);
  assert.equal(result.libraries.length, 1);
});
test('local artwork resolves old and new cache layouts, never request-supplied paths', async t => {
  const root = await fixture(t);
  const cache = path.join(root, 'appcache/librarycache');
  await mkdir(path.join(cache, '10'), { recursive: true });
  const hero = path.join(cache, '10/library_hero.jpg');
  await writeFile(hero, 'fixture-image');
  await writeFile(path.join(cache, '20_library_600x900.jpg'), 'fixture-image');
  assert.equal((await findArtwork([root], '10', 'hero')).path, hero);
  assert.ok((await findArtwork([root], '20')).path.endsWith('20_library_600x900.jpg'));
  assert.equal(await findArtwork([root], '../secret'), null);
  assert.equal(await findArtwork([root], '30'), null);
});

test('artwork finds portraits and hero images inside content-hash directories', async t => {
  const root = await fixture(t);
  const cache = path.join(root, 'appcache/librarycache/3768760');
  const portraitFolder = path.join(cache, 'a'.repeat(40));
  const heroFolder = path.join(cache, 'b'.repeat(40));
  await mkdir(portraitFolder, { recursive: true });
  await mkdir(heroFolder, { recursive: true });
  const portrait = path.join(portraitFolder, 'library_600x900.jpg');
  const hero = path.join(heroFolder, 'library_hero.jpg');
  await writeFile(portrait, 'portrait');
  await writeFile(hero, 'hero');
  assert.equal((await findArtwork([root], '3768760', 'cover'))?.path, portrait);
  assert.equal((await findArtwork([root], '3768760', 'hero'))?.path, hero);
});

test('library_capsule is a portrait and is preferred over a header in an earlier Steam root', async t => {
  const root = await fixture(t);
  const older = path.join(root, 'OldSteam');
  const newer = path.join(root, 'CurrentSteam');
  const flat = path.join(older, 'appcache/librarycache/570');
  const nested = path.join(newer, 'appcache/librarycache/570', 'c'.repeat(40));
  await mkdir(flat, { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(flat, 'header.jpg'), 'landscape header');
  const portrait = path.join(nested, 'library_capsule.jpg');
  await writeFile(portrait, 'portrait');
  assert.equal((await findArtwork([older, newer], '570', 'cover'))?.path, portrait);
});

test('artwork supports library_header and sends the correct image type', async t => {
  const root = await fixture(t);
  const cache = path.join(root, 'appcache/librarycache/284160', 'd'.repeat(40));
  await mkdir(cache, { recursive: true });
  const header = path.join(cache, 'library_header.png');
  await writeFile(header, 'header');
  assert.deepEqual(await findArtwork([root], '284160', 'cover'), { path: header, type: 'image/png' });
});

test('artwork picks the newest complete cached version within the preferred shape', async t => {
  const root = await fixture(t);
  const appCache = path.join(root, 'appcache/librarycache/220');
  const version = path.join(appCache, 'e'.repeat(40));
  await mkdir(version, { recursive: true });
  const oldImage = path.join(appCache, 'library_600x900.jpg');
  const newImage = path.join(version, 'library_capsule.jpg');
  await writeFile(oldImage, 'older');
  await writeFile(newImage, 'newer');
  await utimes(oldImage, new Date('2025-01-01'), new Date('2025-01-01'));
  await utimes(newImage, new Date('2026-01-01'), new Date('2026-01-01'));
  assert.equal((await findArtwork([root], '220', 'cover'))?.path, newImage);
});

test('artwork skips empty files, icons, blurred heroes and unrelated nested folders', async t => {
  const root = await fixture(t);
  const appCache = path.join(root, 'appcache/librarycache/10');
  const unrelated = path.join(appCache, 'unrelated-folder');
  await mkdir(unrelated, { recursive: true });
  await writeFile(path.join(appCache, 'library_600x900.jpg'), '');
  await writeFile(path.join(appCache, 'logo.png'), 'not a cover');
  await writeFile(path.join(appCache, 'library_hero_blur.jpg'), 'not a cover');
  await writeFile(path.join(unrelated, 'library_600x900.jpg'), 'not in Steam layout');
  assert.equal(await findArtwork([root], '10', 'cover'), null);
  assert.equal(await findArtwork([root], '10', '../invalid'), null);
});
