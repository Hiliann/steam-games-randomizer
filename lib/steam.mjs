import { readdir, readFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scanOwnedLibrary } from './owned.mjs';

const execFileAsync = promisify(execFile);
const utilityIds = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1826330']);
const utilityName = /^(Steamworks Common Redistributables|SteamVR|Steam Linux Runtime.*|Proton.*|Steamworks SDK.*|Steam Controller Configs.*)$/i;

// Valve KeyValues: tokenization preserves escaped quotes, backslashes and comments.
export function parseVdf(source) {
  const tokens = [];
  const token = /\s+|\/\/[^\r\n]*|"((?:\\.|[^"\\])*)"|([{}])|([^\s{}"]+)/gy;
  let cursor = 0;
  while (cursor < source.length) {
    token.lastIndex = cursor;
    const match = token.exec(source);
    if (!match) throw new Error('Invalid KeyValues syntax');
    cursor = token.lastIndex;
    if (match[1] !== undefined) tokens.push({ value: match[1].replace(/\\([\\"])/g, '$1') });
    else if (match[2]) tokens.push(match[2]);
    else if (match[3]) tokens.push({ value: match[3] });
  }
  let i = 0;
  function object(nested = false, depth = 0) {
    if (depth > 30) throw new Error('KeyValues nesting limit exceeded');
    const result = Object.create(null);
    while (i < tokens.length) {
      if (tokens[i] === '}') {
        if (!nested) throw new Error('Unexpected closing brace');
        i++;
        return result;
      }
      const key = tokens[i++];
      if (!key || typeof key !== 'object') throw new Error('Expected key');
      const value = tokens[i++];
      if (value === '{') result[key.value] = object(true, depth + 1);
      else if (value && typeof value === 'object') result[key.value] = value.value;
      else throw new Error('Expected value');
    }
    if (nested) throw new Error('Unclosed KeyValues object');
    return result;
  }
  return object();
}

async function directoryExists(target) {
  try { return (await stat(target)).isDirectory(); } catch { return false; }
}

export function normalizeLibrary(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024 || input.includes('\0')) return null;
  const value = input.trim().replace(/^"|"$/g, '');
  // Never contact a network share when scanning local installations.
  if (/^(\\\\|\/\/)/.test(value) || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return path.basename(resolved).toLowerCase() === 'steamapps' ? path.dirname(resolved) : resolved;
}

async function defaultCandidates() {
  const roots = [process.env.STEAM_PATH];
  if (process.platform === 'win32') {
    const queries = [
      ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
      ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
      ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
    ];
    const registry = await Promise.all(queries.map(async ([key, name]) => {
      try {
        const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name], { windowsHide: true, timeout: 2500 });
        return stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim();
      } catch { return null; }
    }));
    roots.push(...registry);
    for (let code = 67; code <= 90; code++) {
      const drive = String.fromCharCode(code) + ':\\';
      for (const folder of ['Steam', 'SteamLibrary', 'SteamGames', 'Program Files (x86)\\Steam', 'Program Files\\Steam']) {
        roots.push(path.join(drive, folder));
      }
    }
  } else {
    roots.push(path.join(os.homedir(), '.steam/steam'), path.join(os.homedir(), '.local/share/Steam'), path.join(os.homedir(), 'Library/Application Support/Steam'));
  }
  return roots.filter(Boolean);
}

async function readSmallText(target) {
  if ((await stat(target)).size > 2 * 1024 * 1024) throw new Error('Metadata file too large');
  return readFile(target, 'utf8');
}

export async function scanSteam({ customPaths = [], candidates, includeUninstalled = false, ownedScan = scanOwnedLibrary } = {}) {
  const roots = new Map();
  const warnings = [];
  const keyFor = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const add = value => {
    const normalized = normalizeLibrary(value);
    if (normalized && !roots.has(keyFor(normalized))) roots.set(keyFor(normalized), normalized);
  };
  for (const value of [...(candidates ?? await defaultCandidates()), ...customPaths]) add(value);
  const accessible = await Promise.all([...roots.values()].map(async root => await directoryExists(path.join(root, 'steamapps')) ? root : null));
  roots.clear();
  for (const root of accessible.filter(Boolean)) add(root);
  for (const custom of customPaths) {
    const normalized = normalizeLibrary(custom);
    if (!normalized || !await directoryExists(path.join(normalized, 'steamapps'))) warnings.push(`Не найдена папка steamapps: ${custom}`);
  }
  // Newly discovered roots are also inspected: installations may point at each other.
  for (const root of roots.values()) {
    try {
      const data = parseVdf(await readSmallText(path.join(root, 'steamapps/libraryfolders.vdf')));
      for (const [key, entry] of Object.entries(data.libraryfolders ?? data.LibraryFolders ?? {})) {
        if (/^\d+$/.test(key)) add(typeof entry === 'object' ? entry.path : entry);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`Не удалось прочитать список библиотек: ${root}`);
    }
    if (roots.size > 100) break;
  }
  const gamesById = new Map();
  const libraries = [];
  let skipped = 0;
  let utilities = 0;
  for (const root of roots.values()) {
    let entries;
    try { entries = await readdir(path.join(root, 'steamapps'), { withFileTypes: true }); }
    catch { libraries.push({ path: root, available: false, count: 0 }); continue; }
    let count = 0;
    for (const entry of entries) {
      const match = /^appmanifest_(\d+)\.acf$/i.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      try {
        const data = parseVdf(await readSmallText(path.join(root, 'steamapps', entry.name))).AppState;
        if (!data || data.appid !== match[1] || !data.name || !data.installdir) { skipped++; continue; }
        const flags = Number(data.StateFlags);
        const common = path.join(root, 'steamapps/common');
        const installPath = path.resolve(common, data.installdir);
        const relative = path.relative(common, installPath);
        const safePath = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        // FullyInstalled bit (4) may coexist with UpdateRequired (2).
        if (!Number.isInteger(flags) || !(flags & 4) || !safePath || !await directoryExists(installPath)) { skipped++; continue; }
        const installedFiles = await readdir(installPath);
        if (!installedFiles.length) { skipped++; continue; }
        if (utilityIds.has(data.appid) || utilityName.test(data.name)) { utilities++; continue; }
        count++;
        const game = {
          id: data.appid, name: data.name, library: root, installed: true,
          disk: path.parse(root).root.replace(/[\\/]+$/, '') || '/',
          size: Math.max(0, Number(data.SizeOnDisk) || 0),
          lastPlayed: Math.max(0, Number(data.LastPlayed) || 0),
          updateRequired: Boolean(flags & 2),
        };
        // The same AppID can appear in old copies of several libraries.
        if (!gamesById.has(game.id) || game.lastPlayed > gamesById.get(game.id).lastPlayed) gamesById.set(game.id, game);
      } catch { skipped++; warnings.push(`Не удалось прочитать ${entry.name} в ${root}`); }
    }
    libraries.push({ path: root, available: true, count });
  }
  const installedCount = gamesById.size;
  let ownedLibrary = { status: 'not-requested' };
  if (includeUninstalled) {
    const owned = await ownedScan([...roots.values()], parseVdf);
    ownedLibrary = owned.info;
    for (const game of owned.games) {
      if (game.id === '480' || utilityIds.has(game.id) || utilityName.test(game.name)) continue;
      if (!gamesById.has(game.id)) gamesById.set(game.id, game);
    }
    ownedLibrary.addedCount = gamesById.size - installedCount;
  }
  const games = [...gamesById.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { games, installedCount, ownedLibrary, libraries, warnings, skipped, utilities, scannedAt: new Date().toISOString(), cacheRoots: [...roots.values()] };
}

export async function findArtwork(roots, id, kind = 'cover') {
  if (!/^\d+$/.test(id) || !['cover', 'hero'].includes(kind)) return null;
  const portraits = ['library_600x900', 'library_capsule'];
  const headers = ['library_header', 'header'];
  const groups = kind === 'hero' ? [['library_hero'], headers, portraits] : [portraits, headers, ['library_hero']];
  const imageTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const locations = await Promise.all(roots.map(async root => {
    const cache = path.join(root, 'appcache/librarycache');
    const appCache = path.join(cache, id);
    let versions = [];
    try {
      // Current Steam versions keep images under AppID/content-hash/filename.
      // Inspect only one level of hash directories, never recursively scan Steam.
      const entries = await readdir(appCache, { withFileTypes: true });
      versions = entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{32,64}$/i.test(entry.name))
        .slice(0, 128).map(entry => path.join(appCache, entry.name));
    } catch { /* An older installation may only have flat cache files. */ }
    return { cache, directories: [appCache, ...versions] };
  }));
  for (const group of groups) {
    // Look for the requested shape in every root before accepting a fallback.
    // For instance, a nested portrait outranks an older, flat landscape header.
    const candidates = locations.flatMap(({ cache, directories }) => group.flatMap(name =>
      Object.entries(imageTypes).flatMap(([extension, type]) => {
        const filename = `${name}.${extension}`;
        return [...directories.map(directory => path.join(directory, filename)), path.join(cache, `${id}_${filename}`)]
          .map(candidate => ({ path: candidate, type }));
      })));
    const available = (await Promise.all(candidates.map(async candidate => {
      try {
        const info = await lstat(candidate.path);
        if (info.isFile() && info.size > 0 && info.size < 15 * 1024 * 1024) return { ...candidate, modified: info.mtimeMs };
      } catch { /* Missing or partially written cached images are expected. */ }
      return null;
    }))).filter(Boolean);
    available.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
    if (available.length) return { path: available[0].path, type: available[0].type };
  }
  return null;
}
