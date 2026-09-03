export const UI_DEFAULTS = Object.freeze({ language: 'ru', theme: 'forest', accent: 'lime' });
export const UI_OPTIONS = Object.freeze({
  language: Object.freeze(['ru', 'en']),
  theme: Object.freeze(['forest', 'midnight', 'graphite']),
  accent: Object.freeze(['lime', 'blue', 'violet', 'orange']),
});

export function validUiSettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(UI_DEFAULTS).length
    && Object.entries(UI_OPTIONS).every(([key, allowed]) => allowed.includes(value[key]));
}

export function applyUiSettings(settings) {
  if (!validUiSettings(settings) || typeof document === 'undefined') return;
  document.documentElement.lang = settings.language;
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.accent = settings.accent;
  const color = settings.theme === 'forest' ? '#101210' : settings.theme === 'midnight' ? '#0d121b' : '#121212';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function createUiSettingsClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/ui-settings', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить язык и оформление.');
    if (!validUiSettings(result)) throw new Error('Приложение вернуло некорректные настройки интерфейса. Обнови страницу.');
    return result;
  }
  return { load: () => request(), set: (key, value) => request({ key, value }) };
}
