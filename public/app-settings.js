export const APP_DEFAULTS = Object.freeze({ automaticUpdates: false, showUpdateNotifications: true });

export function validAppSettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(APP_DEFAULTS).length
    && Object.keys(APP_DEFAULTS).every(key => typeof value[key] === 'boolean');
}

export function normalizeAppSettings(value) {
  if (validAppSettings(value)) return { ...value };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && typeof value.automaticUpdates === 'boolean') {
    return { automaticUpdates: value.automaticUpdates, showUpdateNotifications: true };
  }
  return null;
}

export function startupUpdateAction(settings, updateInfo) {
  if (!validAppSettings(settings) || updateInfo?.status !== 'ready' || updateInfo.updateAvailable !== true || updateInfo.installable !== true) return 'none';
  if (settings.automaticUpdates) return 'install';
  return settings.showUpdateNotifications ? 'notify' : 'none';
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
