import { open, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequestGate } from './request-gate.mjs';
import { cleanGenreNames, cleanStoreEntry } from '../public/store-details.js';

export const MAX_STORE_DETAILS_BYTES = 8 * 1024 ** 2;
export const STORE_UNAVAILABLE_RETRY = 7 * 86400000;
const MAX_ENTRIES = 50000;
const MAX_RESPONSE = 512 * 1024;
const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;
// Steam Store category IDs. Only these confirm a play mode.
const SINGLE = new Set([2]);
const MULTI = new Set([1, 9, 20, 24, 27, 36, 37, 38, 39, 47, 48, 49]);
const COOP = new Set([9, 38, 39, 48]);

export function parseStoreDetails(data) {
  const genres = [], names = {};
  for (const genre of Array.isArray(data?.genres) ? data.genres.slice(0, 30) : []) {
    const id = String(genre?.id ?? '');
    if (!/^[1-9]\d{0,3}$/.test(id)) continue;
    genres.push(id);
    if (typeof genre.description === 'string') names[id] = genre.description.trim().slice(0, 64);
  }
  // No category list means Steam did not state the modes: keep them unknown.
  const ids = Array.isArray(data?.categories) ? data.categories.map(item => Number(item?.id)).filter(Number.isSafeInteger) : null;
  const features = ids && { single: ids.some(id => SINGLE.has(id)), multi: ids.some(id => MULTI.has(id)), coop: ids.some(id => COOP.has(id)) };
  return { entry: cleanStoreEntry({ genres, features }), names: cleanGenreNames(names) };
}

async function boundedJson(response) {
  if (!response.ok) throw Object.assign(new Error('Steam Store unavailable'), { upstreamStatus: response.status });
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { await response.body?.cancel(); throw new Error('Response too large'); }
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE) throw new Error('Response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Loads Store genres and play modes for the whole library in the background.
// Confirmed entries are kept without expiry; only missing games are requested.
export function createStoreDetailsService({ filename, send = globalThis.fetch, gate = createRequestGate(), isForegroundBusy = () => false } = {}) {
  const { now, wait } = gate;
  const entries = new Map();
  let names = {}, loaded, writable = true, dirty = 0, saveQueue = Promise.resolve();
  let targets = [], enabled = async () => false, running = null, state = 'idle', revision = 0, disposed = false;
  const skipped = new Set();
  const fresh = item => item && (item.available || now() - item.checkedAt < STORE_UNAVAILABLE_RETRY);

  async function load() {
    if (!loaded) loaded = (async () => {
      if (!filename) return;
      let file;
      try {
        file = await open(filename, 'r');
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_STORE_DETAILS_BYTES) throw new Error('Invalid cache size');
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new Error('Cache changed during read');
          offset += bytesRead;
        }
        const data = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
        if (data?.version !== 1 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries) || Object.keys(data.entries).length > MAX_ENTRIES) throw new Error('Invalid cache');
        const restored = [];
        for (const [id, item] of Object.entries(data.entries)) {
          if (!validId(id) || !Number.isSafeInteger(item?.checkedAt) || item.checkedAt < 0 || item.checkedAt > now() + 60000 || typeof item.available !== 'boolean') throw new Error('Invalid entry');
          const entry = item.available ? cleanStoreEntry(item) : null;
          if (item.available && !entry) throw new Error('Invalid entry');
          restored.push([id, { available: item.available, checkedAt: item.checkedAt, ...(entry ?? {}), rev: 1 }]);
        }
        for (const [id, item] of restored) entries.set(id, item);
        names = cleanGenreNames(data.names);
        revision = restored.length ? 1 : 0;
      } catch (error) {
        // A damaged cache is preserved untouched; new results stay in memory only.
        if (error.code !== 'ENOENT') writable = false;
      } finally { await file?.close(); }
    })();
    await loaded;
  }

  async function persist() {
    if (!filename || !writable || !dirty) return;
    dirty = 0;
    const task = saveQueue.then(async () => {
      let file, temporary;
      try {
        await mkdir(path.dirname(filename), { recursive: true });
        temporary = path.join(path.dirname(filename), `.store-details-${randomUUID()}.tmp`);
        file = await open(temporary, 'wx', 0o600);
        const stored = Object.fromEntries([...entries].map(([id, { rev, ...item }]) => [id, item]));
        await file.writeFile(JSON.stringify({ version: 1, names, entries: stored }) + '\n', 'utf8');
        await file.sync(); await file.close(); file = null;
        await rename(temporary, filename);
      } catch { writable = false; }
      finally { await file?.close().catch(() => {}); if (temporary) await unlink(temporary).catch(() => {}); }
    });
    saveQueue = task.catch(() => {});
    await task;
  }

  async function fetchOne(id) {
    // Only a public AppID goes to this fixed host. No account, cookie or path data.
    const url = `https://store.steampowered.com/api/appdetails?appids=${id}&l=english&filters=genres,categories`;
    const response = await send(url, { signal: AbortSignal.timeout(8000), redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
    const json = await boundedJson(response);
    const result = json?.[id];
    if (typeof result?.success !== 'boolean') throw new Error('Malformed Steam response');
    revision++;
    if (!result.success || !result.data) { entries.set(id, { available: false, checkedAt: now(), rev: revision }); return; }
    const { entry, names: found } = parseStoreDetails(result.data);
    if (!entry) throw new Error('Malformed Steam details');
    names = { ...names, ...found };
    entries.delete(id);
    entries.set(id, { available: true, checkedAt: now(), ...entry, rev: revision });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  const nextMissing = () => targets.find(id => !fresh(entries.get(id)) && !skipped.has(id));

  async function work() {
    await load();
    try {
      while (!disposed) {
        if (!(await enabled().catch(() => false))) { state = 'disabled'; return; }
        const id = nextMissing();
        if (!id) { state = 'idle'; return; }
        if (gate.blocked()) { state = 'blocked'; await persist(); await wait(Math.min(gate.remaining(), 60000)); continue; }
        state = 'loading';
        // Requests for the selected game or visible cards go first.
        while (isForegroundBusy() && !disposed) await wait(500);
        await gate.turn();
        if (disposed || gate.blocked()) continue;
        try { await fetchOne(id); dirty++; }
        catch (error) { skipped.add(id); gate.failure(error.upstreamStatus); }
        if (dirty >= 10) await persist();
      }
    } finally { await persist(); }
  }

  function progress(ids = targets) {
    let known = 0, unavailable = 0;
    for (const id of ids) {
      const item = entries.get(id);
      if (item?.available) known++;
      else if (item) unavailable++;
    }
    const pending = ids.length - known - unavailable;
    return { state, total: ids.length, known, unavailable, pending };
  }

  return {
    // Replaces the wanted set (the current library). Earlier failures get one
    // new attempt per schedule, so a refresh retries them.
    async schedule(ids, isEnabled) {
      targets = [...new Set(ids.filter(validId))].slice(0, MAX_ENTRIES);
      enabled = isEnabled;
      skipped.clear();
      if (!running) state = 'loading';
      if (!running) running = work().finally(() => { running = null; });
      return running;
    },
    async read(since = 0) {
      await load();
      const changed = {};
      for (const id of targets) {
        const item = entries.get(id);
        if (!item || item.rev <= since) continue;
        changed[id] = item.available ? { genres: item.genres, features: item.features } : null;
      }
      return { revision, progress: progress(), entries: changed, names };
    },
    progress,
    dispose() { disposed = true; },
  };
}
