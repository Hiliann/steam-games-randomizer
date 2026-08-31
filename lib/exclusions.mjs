import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_EXCLUSIONS = 20000;
export const MAX_EXCLUSIONS_BYTES = 512 * 1024;
const validId = id => typeof id === 'string' && /^\d{1,10}$/.test(id) && Number(id) <= 0xffffffff;
const invalidRequest = () => Object.assign(new Error('Некорректный список исключений.'), { status: 400 });
function validateIds(value) {
  if (!Array.isArray(value) || value.length > MAX_EXCLUSIONS || value.some(id => !validId(id))) throw invalidRequest();
  return [...new Set(value)];
}

export function createExclusionsStore(filename) {
  // Each change is applied to the latest file, not a whole-list browser snapshot.
  // Serialize read-modify-write operations so concurrent tabs cannot lose IDs.
  let queue = Promise.resolve();
  function serialized(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  }
  async function read() {
    let file;
    try {
      file = await open(filename, 'r');
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_EXCLUSIONS_BYTES) throw new Error('Invalid exclusions file size');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('Exclusions file changed during read');
        offset += bytesRead;
      }
      const data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (data?.version !== 1) throw new Error('Unsupported exclusions file');
      return { initialized: true, excluded: validateIds(data.excluded) };
    } catch (error) {
      if (!file && error.code === 'ENOENT') return { initialized: false, excluded: [] };
      // Never replace an unreadable or damaged file with an empty list.
      throw Object.assign(new Error('Не удалось прочитать сохранённые исключения. Файл data/exclusions.json оставлен без изменений. Проверь доступ к папке приложения и обнови список.'), { status: 503 });
    } finally { await file?.close(); }
  }
  async function write(excluded) {
    let temporary;
    let file;
    try {
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = path.join(path.dirname(filename), `.exclusions-${randomUUID()}.tmp`);
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ version: 1, excluded }) + '\n', 'utf8');
      await file.sync();
      await file.close(); file = null;
      // Acknowledgement is sent only after a complete file replaces the old one.
      await rename(temporary, filename);
      return { initialized: true, excluded };
    } catch {
      throw Object.assign(new Error('Не удалось сохранить исключения. Проверь, что папка приложения доступна для записи, и обнови список перед повторной попыткой.'), { status: 503 });
    } finally {
      await file?.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  return {
    read: () => serialized(read),
    change: body => serialized(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidRequest();
      if (body.action === 'initialize') {
        const imported = validateIds(body.excluded);
        const current = await read();
        // An empty saved list is intentional. Do not resurrect stale browser IDs.
        return current.initialized ? current : write(imported);
      }
      if (body.action !== 'set' || !validId(body.id) || typeof body.excluded !== 'boolean') throw invalidRequest();
      const current = await read();
      const ids = new Set(current.excluded);
      if (body.excluded) ids.add(body.id); else ids.delete(body.id);
      if (ids.size > MAX_EXCLUSIONS) throw invalidRequest();
      if (current.initialized && ids.size === current.excluded.length && current.excluded.every(id => ids.has(id))) return current;
      return write([...ids]);
    }),
  };
}
