import { open, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const SIZE_CACHE_TTL = 7 * 86400000;
export const SIZE_MISS_TTL = 86400000;
export const MAX_SIZE_RESPONSE = 2 * 1024 ** 2;
const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;
const platformFields = { windows: 'pc_requirements', linux: 'linux_requirements', macos: 'mac_requirements' };
const validBytes = n => Number.isSafeInteger(n) && n > 0 && n <= 1024 ** 5;

function plainLines(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:li|p|div|ul|br)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').replace(/&amp;/gi, '&')
    .split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
}

// Only storage-labelled lines: never confuse RAM or VRAM with game size.
export function parseStorageRequirement(requirements) {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return null;
  const values = [];
  for (const html of [requirements.minimum, requirements.recommended]) {
    if (typeof html !== 'string' || html.length > 128000) continue;
    for (const line of plainLines(html)) {
      if (!/^(?:storage(?:\s+(?:space|drive))?|hard\s*(?:drive|disk)(?:\s+space)?|disk\s*space|hdd|ssd|место на диске|ж[её]сткий диск)\s*[:：-]/i.test(line)) continue;
      if (/[:：]\s*-\s*\d/.test(line)) continue;
      // A range such as 20-30 GB reserves the larger amount, not the first one.
      const range = /(\d+(?:[.,]\d+)?)\s*[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)\b/i.exec(line);
      const matches = range ? [[null, range[2], range[3]]] : [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|ТБ|ГБ|МБ|КБ)(?=\s|$|[.,;)])/gi)];
      for (const match of matches) {
        const power = { KB: 1, MB: 2, GB: 3, TB: 4, КБ: 1, МБ: 2, ГБ: 3, ТБ: 4 }[match[2].toUpperCase()];
        const number = /^\d{1,3}(?:,\d{3})+$/.test(match[1]) ? match[1].replaceAll(',', '') : match[1].replace(',', '.');
        const bytes = Math.round(Number(number) * 1024 ** power);
        if (validBytes(bytes)) values.push(bytes);
      }
    }
  }
  return values.length ? Math.max(...values) : null;
}

async function boundedJson(response) {
  if (!response.ok) throw Object.assign(new Error('Steam Store unavailable'), { upstreamStatus: response.status });
  if (Number(response.headers.get('content-length')) > MAX_SIZE_RESPONSE) { await response.body?.cancel(); throw new Error('Response too large'); }
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_SIZE_RESPONSE) throw new Error('Response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createOnlineSizeService({ filename, send = globalThis.fetch, now = Date.now, interval = 2000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const cache = new Map(), pending = new Map(), retryAt = new Map();
  let loaded, writable = true, saveQueue = Promise.resolve(), startQueue = Promise.resolve(), lastStart = -Infinity, blockedUntil = 0;
  async function load() {
    if (!loaded) loaded = (async () => {
      if (!filename) return;
      let file;
      try {
        file = await open(filename, 'r');
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_SIZE_RESPONSE) throw new Error('Invalid cache size');
        const bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new Error('Cache changed during read');
          offset += bytesRead;
        }
        const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        if (data?.version !== 1 || !data.entries || Array.isArray(data.entries) || typeof data.entries !== 'object' || Object.keys(data.entries).length > 5000) throw new Error('Invalid cache');
        const entries = Object.entries(data.entries);
        for (const [key, item] of entries) {
          if (!/^(windows|linux|macos):[1-9]\d{0,9}$/.test(key) || !validId(key.split(':')[1]) || !Number.isSafeInteger(item?.checkedAt) || item.checkedAt < 0 || item.checkedAt > now() + 60000 || (item.bytes !== null && !validBytes(item.bytes))) throw new Error('Invalid cached size');
        }
        for (const entry of entries) cache.set(...entry);
      } catch (error) {
        // A damaged/unreadable cache is kept intact. Lookups still work in memory.
        if (error.code !== 'ENOENT') writable = false;
      } finally { await file?.close(); }
    })();
    await loaded;
  }
  async function persist() {
    if (!filename || !writable) return;
    const task = saveQueue.then(async () => {
      let file, temporary;
      try {
        while (cache.size > 5000) cache.delete(cache.keys().next().value);
        await mkdir(path.dirname(filename), { recursive: true });
        temporary = path.join(path.dirname(filename), `.online-sizes-${randomUUID()}.tmp`);
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(JSON.stringify({ version: 1, entries: Object.fromEntries(cache) }) + '\n', 'utf8');
        await file.sync(); await file.close(); file = null;
        await rename(temporary, filename);
      } catch { writable = false; }
      finally { await file?.close().catch(() => {}); if (temporary) await unlink(temporary).catch(() => {}); }
    });
    saveQueue = task.catch(() => {});
    await task;
  }
  const result = (id, platform, item, status, cached = false) => ({
    status, cached, cacheSaved: writable,
    size: item?.bytes ? { bytes: item.bytes, kind: 'required-space', source: 'steam-store', sourceUrl: `https://store.steampowered.com/app/${id}/`, platform, checkedAt: item.checkedAt, stale: now() - item.checkedAt >= SIZE_CACHE_TTL } : null,
  });
  function validate(id, platform) {
    if (!validId(id) || !Object.hasOwn(platformFields, platform)) throw Object.assign(new Error('Некорректная игра или платформа.'), { status: 400 });
  }
  return {
    async getCached(id, platform = 'windows') {
      validate(id, platform); await load();
      const item = cache.get(`${platform}:${id}`);
      return item?.bytes ? result(id, platform, item, 'ready', true).size : null;
    },
    async lookup(id, platform = 'windows') {
      validate(id, platform); await load();
      const key = `${platform}:${id}`, old = cache.get(key);
      if (old && now() - old.checkedAt < (old.bytes ? SIZE_CACHE_TTL : SIZE_MISS_TTL)) return result(id, platform, old, old.bytes ? 'ready' : 'not-found', true);
      if (pending.has(key)) return pending.get(key);
      if (now() < blockedUntil || now() < (retryAt.get(key) ?? 0)) return result(id, platform, old, 'offline', !!old);
      if (pending.size >= 6) return result(id, platform, old, 'busy', !!old);
      const task = (async () => {
        try {
          const turn = startQueue.then(async () => { await wait(Math.max(0, lastStart + interval - now())); lastStart = now(); });
          startQueue = turn.catch(() => {}); await turn;
          if (now() < blockedUntil) return result(id, platform, old, 'offline', !!old);
          // Only a public AppID goes to this fixed host. No account/cookie/path data.
          const url = `https://store.steampowered.com/api/appdetails?appids=${id}&l=english&filters=basic,pc_requirements,mac_requirements,linux_requirements`;
          const response = await send(url, { signal: AbortSignal.timeout(8000), redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
          const json = await boundedJson(response);
          const entry = json?.[id];
          if (typeof entry?.success !== 'boolean') throw new Error('Malformed Steam response');
          if (entry.success && (!entry.data || String(entry.data.steam_appid) !== id)) throw new Error('Wrong Steam AppID');
          const bytes = entry.success ? parseStorageRequirement(entry.data[platformFields[platform]]) : null;
          // Keep a previously known value if a later response omits requirements.
          if (!bytes && old?.bytes) { retryAt.set(key, now() + SIZE_MISS_TTL); return result(id, platform, old, 'not-found', true); }
          const item = { bytes, checkedAt: now() };
          cache.delete(key); cache.set(key, item);
          retryAt.delete(key); await persist();
          return result(id, platform, item, bytes ? 'ready' : 'not-found');
        } catch (error) {
          retryAt.set(key, now() + 5 * 60000);
          if ([403, 429].includes(error.upstreamStatus)) blockedUntil = now() + 30 * 60000;
          else blockedUntil = Math.max(blockedUntil, now() + 30000);
          return result(id, platform, old, 'offline', !!old);
        } finally { pending.delete(key); }
      })();
      pending.set(key, task);
      return task;
    },
  };
}
