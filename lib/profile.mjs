import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanDrawState } from '../public/randomizer.js';

export const MAX_PROFILE_BYTES = 4 * 1024 * 1024;
export const MAX_CATEGORIES = 20;
export const MAX_CATEGORY_SCOPE = 25000;
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'to-play', name: 'Хочу пройти', color: 'lime' },
  { id: 'favorite', name: 'Любимые', color: 'gold' },
  { id: 'company', name: 'Для компании', color: 'blue' },
  { id: 'relaxed', name: 'Расслабиться', color: 'mint' },
  { id: 'quick', name: 'На 30 минут', color: 'orange' },
  { id: 'story', name: 'Сюжетные', color: 'violet' },
]);
const colors = ['lime', 'gold', 'blue', 'mint', 'orange', 'violet', 'rose', 'slate'];
const validAppId = id => typeof id === 'string' && /^\d{1,10}$/.test(id) && Number(id) <= 0xffffffff;
const validCategoryId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(id);
const invalid = message => Object.assign(new Error(message), { status: 400 });

function cleanName(value) {
  if (typeof value !== 'string') throw invalid('Название категории должно быть текстом.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid('Название категории должно содержать от 1 до 32 символов.');
  return name;
}
function validateProfile(data) {
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.categories) || data.categories.length > MAX_CATEGORIES) throw new Error('Invalid profile');
  const seenCategories = new Set();
  const categories = data.categories.map(item => {
    if (!item || !validCategoryId(item.id) || seenCategories.has(item.id) || !colors.includes(item.color)) throw new Error('Invalid category');
    seenCategories.add(item.id);
    return { id: item.id, name: cleanName(item.name), color: item.color };
  });
  if (!data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments) || Object.getPrototypeOf(data.assignments) !== Object.prototype) throw new Error('Invalid assignments');
  const assignments = {};
  let references = 0;
  for (const [appId, categoryIds] of Object.entries(data.assignments)) {
    if (!validAppId(appId) || !Array.isArray(categoryIds) || categoryIds.length > MAX_CATEGORIES) throw new Error('Invalid assignment');
    const cleaned = [...new Set(categoryIds)];
    if (cleaned.some(id => !seenCategories.has(id))) throw new Error('Unknown category');
    references += cleaned.length;
    if (references > 100000) throw new Error('Too many assignments');
    if (cleaned.length) assignments[appId] = cleaned;
  }
  const draw = cleanDrawState(data.draw);
  if (draw.mode.startsWith('category:') && !seenCategories.has(draw.mode.slice(9))) draw.mode = 'all';
  return { version: 1, revision: data.revision, categories, assignments, draw };
}
const initial = draw => ({ version: 1, revision: 1, categories: DEFAULT_CATEGORIES.map(item => ({ ...item })), assignments: {}, draw: cleanDrawState(draw) });

export function createProfileStore(filename) {
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
      if (!info.isFile() || info.size > MAX_PROFILE_BYTES) throw new Error('Invalid profile size');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('Profile changed during read');
        offset += bytesRead;
      }
      return { initialized: true, ...validateProfile(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))) };
    } catch (error) {
      if (!file && error.code === 'ENOENT') return { initialized: false, ...initial() };
      throw Object.assign(new Error('Не удалось прочитать категории и историю. Файл data/profile.json оставлен без изменений. Проверь доступ к папке приложения.'), { status: 503 });
    } finally { await file?.close(); }
  }
  async function write(profile) {
    let temporary, file;
    try {
      const checked = validateProfile(profile);
      await mkdir(path.dirname(filename), { recursive: true });
      temporary = path.join(path.dirname(filename), `.profile-${randomUUID()}.tmp`);
      file = await open(temporary, 'wx', 0o600);
      await file.writeFile(JSON.stringify(checked) + '\n', 'utf8');
      await file.sync();
      await file.close(); file = null;
      await rename(temporary, filename);
      return { initialized: true, ...checked };
    } catch (error) {
      if (error.status === 400) throw error;
      throw Object.assign(new Error('Не удалось сохранить категории или историю. Проверь, что папка приложения доступна для записи.'), { status: 503 });
    } finally {
      await file?.close().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  }
  return {
    read: () => serialized(read),
    change: body => serialized(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Некорректное изменение профиля.');
      const current = await read();
      if (body.action === 'initialize') return current.initialized ? current : write(initial(body.draw));
      if (!current.initialized) throw Object.assign(new Error('Сначала обнови список, чтобы создать профиль.'), { status: 409 });
      if (!Number.isSafeInteger(body.revision) || body.revision !== current.revision) throw Object.assign(new Error('Категории или история изменились в другом окне. Обнови список и повтори действие.'), { status: 409 });
      const next = { ...current, initialized: undefined, revision: current.revision + 1, categories: current.categories.map(item => ({ ...item })), assignments: structuredClone(current.assignments), draw: { ...current.draw } };
      if (body.action === 'replace-draw') next.draw = cleanDrawState(body.draw);
      else if (body.action === 'add-category') {
        if (next.categories.length >= MAX_CATEGORIES) throw invalid(`Можно создать не больше ${MAX_CATEGORIES} категорий.`);
        const name = cleanName(body.name);
        if (next.categories.some(item => item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw invalid('Категория с таким названием уже есть.');
        next.categories.push({ id: `custom-${randomUUID().replaceAll('-', '').slice(0, 12)}`, name, color: colors[next.categories.length % colors.length] });
      } else if (body.action === 'rename-category') {
        const category = next.categories.find(item => item.id === body.id);
        if (!category) throw invalid('Категория не найдена.');
        const name = cleanName(body.name);
        if (next.categories.some(item => item.id !== body.id && item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) throw invalid('Категория с таким названием уже есть.');
        category.name = name;
      } else if (body.action === 'delete-category') {
        if (!validCategoryId(body.id) || !next.categories.some(item => item.id === body.id)) throw invalid('Категория не найдена.');
        next.categories = next.categories.filter(item => item.id !== body.id);
        for (const [appId, ids] of Object.entries(next.assignments)) {
          const remaining = ids.filter(id => id !== body.id);
          if (remaining.length) next.assignments[appId] = remaining; else delete next.assignments[appId];
        }
        if (next.draw.mode === `category:${body.id}`) next.draw.mode = 'all';
      } else if (body.action === 'set-category') {
        if (!validAppId(body.appId) || !validCategoryId(body.categoryId) || typeof body.assigned !== 'boolean' || !next.categories.some(item => item.id === body.categoryId)) throw invalid('Некорректная категория игры.');
        const ids = new Set(next.assignments[body.appId] ?? []);
        if (body.assigned) ids.add(body.categoryId); else ids.delete(body.categoryId);
        if (ids.size) next.assignments[body.appId] = [...ids]; else delete next.assignments[body.appId];
      } else if (body.action === 'set-category-games') {
        if (!validCategoryId(body.categoryId) || !next.categories.some(item => item.id === body.categoryId)
          || !Array.isArray(body.appIds) || !Array.isArray(body.scopeAppIds)
          || body.appIds.length > MAX_CATEGORY_SCOPE || body.scopeAppIds.length > MAX_CATEGORY_SCOPE
          || body.appIds.some(id => !validAppId(id)) || body.scopeAppIds.some(id => !validAppId(id))) throw invalid('Некорректный список игр категории.');
        const selected = new Set(body.appIds);
        const scope = new Set(body.scopeAppIds);
        if (selected.size !== body.appIds.length || scope.size !== body.scopeAppIds.length || [...selected].some(id => !scope.has(id))) throw invalid('Некорректный список игр категории.');
        for (const appId of scope) {
          const ids = new Set(next.assignments[appId] ?? []);
          if (selected.has(appId)) ids.add(body.categoryId); else ids.delete(body.categoryId);
          if (ids.size) next.assignments[appId] = [...ids]; else delete next.assignments[appId];
        }
      } else throw invalid('Неизвестное изменение профиля.');
      return write(next);
    }),
  };
}
