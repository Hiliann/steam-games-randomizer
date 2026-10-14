import { open } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseLicenses, ownedPackageIds, parsePackageInfo, parseAppInfo } from './steam-cache.mjs';

const execFileAsync = promisify(execFile);
async function readBounded(file, maxBytes) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Cache size limit');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Steam cache changed during read');
      offset += bytesRead;
    }
    return { bytes, modified: info.mtime.toISOString() };
  } finally { await handle.close(); }
}

const field = (object, name) => Object.entries(object ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
export function accountCandidates(login, root) {
  return Object.entries(field(login, 'users') ?? {}).flatMap(([id, user]) => {
    if (!/^\d{17}$/.test(id)) return [];
    const accountId = Number(BigInt(id) - 76561197960265728n);
    if (accountId <= 0 || accountId > 0xffffffff) return [];
    return [{ root, accountId, name: String(field(user, 'PersonaName') ?? 'Пользователь Steam').slice(0, 100), timestamp: Number(field(user, 'Timestamp')) || 0, recent: field(user, 'MostRecent') === '1' }];
  });
}

async function activeSteamUser() {
  if (process.platform !== 'win32') return 0;
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], { windowsHide: true, timeout: 2500 });
    return Number(stdout.match(/REG_DWORD\s+(0x[\da-f]+)/i)?.[1]) || 0;
  } catch { return 0; }
}

export async function scanOwnedLibrary(roots, parseText, { activeUser } = {}) {
  const candidates = [];
  for (const root of roots) {
    try {
      const { bytes } = await readBounded(path.join(root, 'config/loginusers.vdf'), 2 * 1024 ** 2);
      candidates.push(...accountCandidates(parseText(bytes.toString('utf8')), root));
    } catch { /* A game library need not contain a Steam client or user cache. */ }
  }
  const activeId = activeUser ?? await activeSteamUser();
  const matching = activeId ? candidates.filter(user => user.accountId === activeId) : candidates;
  matching.sort((a, b) => Number(b.recent) - Number(a.recent) || b.timestamp - a.timestamp);
  const selected = matching[0];
  const unavailable = message => ({ games: [], info: { status: 'unavailable', message } });
  if (!selected) return unavailable('Не найден аккаунт Steam. Войди в Steam, открой библиотеку и нажми «Обновить список».');
  try {
    const { root, accountId } = selected;
    const cache = await readBounded(path.join(root, 'userdata', String(accountId), 'config/licensecache'), 32 * 1024 ** 2);
    const ids = ownedPackageIds(parseLicenses(cache.bytes, accountId), accountId);
    const packages = parsePackageInfo((await readBounded(path.join(root, 'appcache/packageinfo.vdf'), 128 * 1024 ** 2)).bytes, ids);
    const appIds = new Set([...packages.values()].flat());
    const apps = parseAppInfo((await readBounded(path.join(root, 'appcache/appinfo.vdf'), 256 * 1024 ** 2)).bytes, appIds);
    const missing = [...ids].filter(id => !packages.has(id)).length + [...appIds].filter(id => !apps.has(id)).length;
    const games = [...apps.values()].filter(app => app.type === 'game').map(({ id, name }) => ({ id, name, installed: false, library: null, disk: null, size: 0, lastPlayed: 0, updateRequired: false }));
    return { games, info: {
      status: missing ? 'partial' : 'ready', accountName: selected.name, updatedAt: cache.modified, gameCount: games.length,
      message: missing ? 'Часть сведений отсутствует в кэше. Открой библиотеку в Steam онлайн и обнови список здесь.' : 'По локальным лицензиям Steam. После покупок и смены аккаунта обнови список. Семейные и временные лицензии не добавляются.',
    } };
  } catch {
    return unavailable('Не удалось прочитать библиотеку аккаунта. Открой Steam онлайн, дождись загрузки библиотеки и обнови список. Установленные игры по-прежнему доступны.');
  }
}
