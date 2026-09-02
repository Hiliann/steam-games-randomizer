export const APP_DEFAULTS = Object.freeze({ automaticUpdates: false });

export function validAppSettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(APP_DEFAULTS).length
    && Object.keys(APP_DEFAULTS).every(key => typeof value[key] === 'boolean');
}

export function createAppSettingsClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/app-settings', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить настройки программы.');
    if (!validAppSettings(result)) throw new Error('Приложение вернуло некорректные настройки. Обнови страницу.');
    return result;
  }
  return { load: () => request(), set: (key, value) => request({ key, value }) };
}
