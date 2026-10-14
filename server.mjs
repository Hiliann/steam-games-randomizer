import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scanSteam, normalizeLibrary, findArtwork } from './lib/steam.mjs';
import { createExclusionsStore, MAX_EXCLUSIONS_BYTES } from './lib/exclusions.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
export const APP_VERSION = '1.2.1';
export function getInstanceId(directory = base) {
  const resolved = path.resolve(directory);
  return createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex').slice(0, 24);
}
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/randomizer.js', ['randomizer.js', 'text/javascript; charset=utf-8']],
  ['/exclusions.js', ['exclusions.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/responsive.css', ['responsive.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function requestJson(request, limit = 32768) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Ожидается JSON.'), { status: 415 });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Слишком большой запрос.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Некорректный JSON.'), { status: 400 }); }
}

export function createApp({ scan = scanSteam, exclusionsFile = path.join(base, 'data/exclusions.json') } = {}) {
  const exclusions = createExclusionsStore(exclusionsFile);
  let snapshot;
  let scanQueue = Promise.resolve();
  const artworkCache = new Map();
  const refresh = (customPaths, includeUninstalled = false) => {
    const task = scanQueue.then(async () => {
      snapshot = await scan({ customPaths, includeUninstalled });
      artworkCache.clear();
      return snapshot;
    });
    scanQueue = task.catch(() => {});
    return task;
  };
  const publicSnapshot = result => {
    const { cacheRoots, ...rest } = result;
    return rest;
  };
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const host = request.headers.host;
    const port = request.socket.localPort;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(response, 403, { error: 'Разрешён только локальный доступ.' });
    if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: 'Запрос с другого сайта запрещён.' });
    try {
      const url = new URL(request.url, `http://${host}`);
      if (request.headers['sec-fetch-site'] === 'cross-site' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/art/'))) return json(response, 403, { error: 'Запрос с другого сайта запрещён.' });
      if (url.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { app: 'steam-games-randomizer', version: APP_VERSION, instanceId: getInstanceId() });
      if (url.pathname === '/api/exclusions' && request.method === 'GET') return json(response, 200, await exclusions.read());
      if (url.pathname === '/api/exclusions' && request.method === 'POST') {
        if (request.headers['x-randomizer'] !== '1') return json(response, 403, { error: 'Отсутствует заголовок приложения.' });
        return json(response, 200, await exclusions.change(await requestJson(request, MAX_EXCLUSIONS_BYTES)));
      }
      if (url.pathname === '/api/games' && request.method === 'GET') return json(response, 200, publicSnapshot(snapshot ?? await refresh([])));
      if (url.pathname === '/api/scan' && request.method === 'POST') {
        if (request.headers['x-randomizer'] !== '1') return json(response, 403, { error: 'Отсутствует заголовок приложения.' });
        const body = await requestJson(request);
        if (!body || !Array.isArray(body.paths) || body.paths.length > 20 || body.paths.some(value => !normalizeLibrary(value))) return json(response, 400, { error: 'Укажите абсолютный путь к локальной папке Steam или SteamLibrary (до 20 папок).' });
        if (body.includeUninstalled !== undefined && typeof body.includeUninstalled !== 'boolean') return json(response, 400, { error: 'Настройка неустановленных игр должна быть галочкой.' });
        return json(response, 200, publicSnapshot(await refresh(body.paths, body.includeUninstalled === true)));
      }
      const artwork = /^\/art\/(\d+)\/(cover|hero)$/.exec(url.pathname);
      if (artwork && request.method === 'GET') {
        if (!snapshot?.games.some(game => game.id === artwork[1])) { response.writeHead(404); response.end(); return; }
        const key = artwork[1] + '/' + artwork[2];
        if (!artworkCache.has(key)) artworkCache.set(key, await findArtwork(snapshot.cacheRoots ?? [], artwork[1], artwork[2]));
        const found = artworkCache.get(key);
        if (!found) { response.writeHead(204, { 'Cache-Control': 'no-store' }); response.end(); return; }
        const bytes = await readFile(found.path);
        response.writeHead(200, { 'Content-Type': found.type, 'Cache-Control': 'private, max-age=3600' });
        response.end(bytes);
        return;
      }
      const asset = staticFiles.get(url.pathname);
      if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
        const content = await readFile(path.join(base, 'public', asset[0]));
        response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      return json(response, 404, { error: 'Страница не найдена.' });
    } catch (error) {
      console.error(error.message);
      if (!response.headersSent) json(response, error.status ?? 500, { error: error.status ? error.message : 'Не удалось прочитать библиотеку. Попробуйте обновить список.' });
      else response.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const server = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Open http://127.0.0.1:${port} or set PORT to another number.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Steam Games Randomizer\nLocal: http://127.0.0.1:${port}\nPress Ctrl+C to stop. Steam files are read-only.`));
}
