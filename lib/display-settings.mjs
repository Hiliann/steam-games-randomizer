import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DISPLAY_DEFAULTS, validDisplaySettings } from '../public/display.js';

export const MAX_DISPLAY_BYTES = 4096;
export function createDisplayStore(filename) {
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
      if (!info.isFile() || info.size > MAX_DISPLAY_BYTES) throw new Error('Invalid size');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('File changed during read');
        offset += bytesRead;
      }
      const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (data?.version !== 1 || !validDisplaySettings(data.settings)) throw new Error('Invalid settings');
      return data.settings;
    } catch (error) {
      if (!file && error.code === 'ENOENT') return { ...DISPLAY_DEFAULTS };
      throw Object.assign(new Error('Не удалось прочитать настройки отображения. Файл data/display-settings.json оставлен без изменений. Проверь доступ к папке приложения.'), { status: 503 });
    } finally { await file?.close(); }
  }
  async function write(settings) {
    let temporary, file;
    try {
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = path.join(path.dirname(filename), `.display-${randomUUID()}.tmp`);
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ version: 1, settings }) + '\n', 'utf8');
      await file.sync();
      await file.close(); file = null;
      await rename(temporary, filename);
      return settings;
    } catch {
      throw Object.assign(new Error('Не удалось сохранить настройки отображения. Проверь, что папка приложения доступна для записи.'), { status: 503 });
    } finally {
      await file?.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  return {
    read: () => serialized(read),
    change: body => serialized(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(DISPLAY_DEFAULTS, body.key) || typeof body.value !== 'boolean') {
        throw Object.assign(new Error('Некорректная настройка отображения.'), { status: 400 });
      }
      // Merge one toggle into the latest saved file, not an old tab's snapshot.
      const settings = await read();
      settings[body.key] = body.value;
      return write(settings);
    }),
  };
}
