import { cleanDrawState } from './randomizer.js';

const CATEGORY_COLORS = new Set(['lime', 'gold', 'blue', 'mint', 'orange', 'violet', 'rose', 'slate']);

function validate(result) {
  if (!result || typeof result.initialized !== 'boolean' || !Number.isSafeInteger(result.revision) || !Array.isArray(result.categories) || result.categories.length > 20 || !result.assignments || typeof result.assignments !== 'object' || Array.isArray(result.assignments)) throw new Error('Приложение вернуло некорректные категории. Обнови страницу.');
  const categoryIds = new Set();
  for (const item of result.categories) {
    if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(item.id) || categoryIds.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 32 || !CATEGORY_COLORS.has(item.color)) throw new Error('Приложение вернуло некорректные категории. Обнови страницу.');
    categoryIds.add(item.id);
  }
  for (const [appId, ids] of Object.entries(result.assignments)) if (!/^\d{1,10}$/.test(appId) || Number(appId) > 0xffffffff || !Array.isArray(ids) || ids.some(id => !categoryIds.has(id))) throw new Error('Приложение вернуло некорректные категории. Обнови страницу.');
  return { initialized: result.initialized, revision: result.revision, categories: result.categories.map(item => ({ id: item.id, name: item.name, color: item.color })), assignments: Object.fromEntries(Object.entries(result.assignments).map(([id, values]) => [id, [...new Set(values)]])), draw: cleanDrawState(result.draw) };
}

export function createProfileClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/profile', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body), keepalive: ['set-category', 'rename-category', 'add-category', 'delete-category'].includes(body.action), signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить категории или историю.');
    return validate(result);
  }
  return {
    async load(legacyDraw = {}) {
      const result = await request();
      return result.initialized ? result : request({ action: 'initialize', draw: legacyDraw });
    },
    replaceDraw(revision, draw) { return request({ action: 'replace-draw', revision, draw }); },
    addCategory(revision, name) { return request({ action: 'add-category', revision, name }); },
    renameCategory(revision, id, name) { return request({ action: 'rename-category', revision, id, name }); },
    deleteCategory(revision, id) { return request({ action: 'delete-category', revision, id }); },
    setCategory(revision, appId, categoryId, assigned) { return request({ action: 'set-category', revision, appId, categoryId, assigned }); },
  };
}
