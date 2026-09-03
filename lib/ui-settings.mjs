import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UI_DEFAULTS, UI_OPTIONS, normalizeUiSettings, validCustomAccent, validUiSettings } from '../public/ui-settings.js';

export const MAX_UI_SETTINGS_BYTES = 4096;

export function createUiSettingsStore(filename) {
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
      if (!info.isFile() || info.size > MAX_UI_SETTINGS_BYTES) throw new Error('Invalid size');
      const data = JSON.parse((await file.readFile('utf8')).replace(/^\uFEFF/, ''));
      const settings = data?.version === 1 || data?.version === 2 ? normalizeUiSettings(data.settings) : null;
      if (!settings) throw new Error('Invalid settings');
      return settings;
    } catch (error) {
      if (!file && error.code === 'ENOENT') return { ...UI_DEFAULTS };
      throw Object.assign(new Error('Не удалось прочитать настройки интерфейса. Файл data/ui-settings.json оставлен без изменений.'), { status: 503 });
    } finally { await file?.close(); }
  }
  async function write(settings) {
    if (!validUiSettings(settings)) throw Object.assign(new Error('Некорректные настройки интерфейса.'), { status: 400 });
    let temporary, file;
    try {
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = path.join(path.dirname(filename), `.ui-settings-${randomUUID()}.tmp`);
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ version: 2, settings }) + '\n', 'utf8');
      await file.sync();
      await file.close(); file = null;
      await rename(temporary, filename);
      return settings;
    } catch (error) {
      if (error.status === 400) throw error;
      throw Object.assign(new Error('Не удалось сохранить настройки интерфейса. Проверь доступ к папке data.'), { status: 503 });
    } finally {
      await file?.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  return {
    read: () => serialized(read),
    replace: settings => serialized(() => {
      const checked = normalizeUiSettings(settings);
      if (!checked) throw Object.assign(new Error('Некорректные настройки интерфейса.'), { status: 400 });
      return write(checked);
    }),
    change: body => serialized(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw Object.assign(new Error('Некорректная настройка интерфейса.'), { status: 400 });
      }
      const settings = await read();
      if (Object.keys(body).length === 1 && validCustomAccent(body.customAccent)) {
        settings.customAccent = Object.fromEntries(Object.entries(body.customAccent).map(([key, color]) => [key, color.toLowerCase()]));
        settings.accent = 'custom';
      } else if (Object.keys(body).length === 2 && Object.hasOwn(UI_OPTIONS, body.key) && UI_OPTIONS[body.key].includes(body.value)) {
        settings[body.key] = body.value;
      } else {
        throw Object.assign(new Error('Некорректная настройка интерфейса.'), { status: 400 });
      }
      return write(settings);
    }),
  };
}
