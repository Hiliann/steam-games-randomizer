import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_DEFAULTS, validAppSettings } from '../public/app-settings.js';

export const MAX_APP_SETTINGS_BYTES = 4096;

export function createAppSettingsStore(filename) {
  let queue = Promise.resolve();
  const serialized = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  async function read() {
    let file;
    try {
      file = await open(filename, 'r');
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_APP_SETTINGS_BYTES) throw new Error('Invalid size');
      const source = await file.readFile('utf8');
      const data = JSON.parse(source.replace(/^\uFEFF/, ''));
      if (data?.version !== 1 || !validAppSettings(data.settings)) throw new Error('Invalid settings');
      return data.settings;
    } catch (error) {
      if (!file && error.code === 'ENOENT') return { ...APP_DEFAULTS };
      throw Object.assign(new Error('Не удалось прочитать настройки программы. Файл data/app-settings.json оставлен без изменений.'), { status: 503 });
    } finally { await file?.close(); }
  }
  async function write(settings) {
    let temporary, file;
    try {
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = path.join(path.dirname(filename), `.app-settings-${randomUUID()}.tmp`);
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ version: 1, settings }) + '\n', 'utf8');
      await file.sync();
      await file.close(); file = null;
      await rename(temporary, filename);
      return settings;
    } catch {
      throw Object.assign(new Error('Не удалось сохранить настройки программы. Проверь доступ к папке data.'), { status: 503 });
    } finally {
      await file?.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  return {
    read: () => serialized(read),
    change: body => serialized(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(APP_DEFAULTS, body.key) || typeof body.value !== 'boolean' || Object.keys(body).length !== 2) {
        throw Object.assign(new Error('Некорректная настройка программы.'), { status: 400 });
      }
      const settings = await read();
      settings[body.key] = body.value;
      return write(settings);
    }),
  };
}
