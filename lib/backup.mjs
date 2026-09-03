import { validateIds } from './exclusions.mjs';
import { validateProfile } from './profile.mjs';
import { validDisplaySettings } from '../public/display.js';
import { normalizeAppSettings } from '../public/app-settings.js';
import { normalizeUiSettings } from '../public/ui-settings.js';

export const MAX_BACKUP_BYTES = 6 * 1024 * 1024;

const invalid = message => Object.assign(new Error(message), { status: 400 });

function cleanBrowser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
    || typeof value.includeUninstalled !== 'boolean' || !Array.isArray(value.customPaths) || value.customPaths.length > 20
    || value.customPaths.some(item => typeof item !== 'string' || item.length < 1 || item.length > 1024 || /[\u0000-\u001f\u007f]/.test(item))) {
    throw invalid('В резервной копии повреждены настройки библиотек.');
  }
  return { includeUninstalled: value.includeUninstalled, customPaths: [...new Set(value.customPaths)] };
}

function cleanBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'play-next-backup' || value.version !== 1
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || typeof value.appVersion !== 'string'
    || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw invalid('Это не резервная копия Play Next или её формат не поддерживается.');
  const keys = Object.keys(value.data).sort();
  if (keys.join(',') !== 'appSettings,displaySettings,exclusions,profile,uiSettings') throw invalid('В резервной копии отсутствует часть данных.');
  let exclusions, profile;
  try {
    exclusions = validateIds(value.data.exclusions);
    profile = validateProfile(value.data.profile);
  } catch { throw invalid('В резервной копии повреждены категории, история или исключения.'); }
  const appSettings = normalizeAppSettings(value.data.appSettings);
  const uiSettings = normalizeUiSettings(value.data.uiSettings);
  if (!validDisplaySettings(value.data.displaySettings) || !appSettings || !uiSettings) {
    throw invalid('В резервной копии повреждены настройки программы.');
  }
  return {
    browser: cleanBrowser(value.browser),
    data: {
      exclusions,
      displaySettings: structuredClone(value.data.displaySettings),
      appSettings,
      uiSettings,
      profile,
    },
  };
}

export function createBackupService({ exclusions, displaySettings, appSettings, uiSettings, profile, appVersion }) {
  const stores = { exclusions, displaySettings, appSettings, uiSettings, profile };
  async function snapshot() {
    const [excluded, display, app, ui, savedProfile] = await Promise.all([
      exclusions.read(), displaySettings.read(), appSettings.read(), uiSettings.read(), profile.read(),
    ]);
    const { initialized, ...profileData } = savedProfile;
    return {
      exclusions: excluded.excluded,
      displaySettings: display,
      appSettings: app,
      uiSettings: ui,
      profile: profileData,
    };
  }
  async function replaceAll(data) {
    await stores.exclusions.replace(data.exclusions);
    await stores.displaySettings.replace(data.displaySettings);
    await stores.appSettings.replace(data.appSettings);
    await stores.uiSettings.replace(data.uiSettings);
    await stores.profile.replace(data.profile);
  }
  return {
    export: async () => ({
      format: 'play-next-backup', version: 1, createdAt: new Date().toISOString(), appVersion, data: await snapshot(),
    }),
    restore: async value => {
      const checked = cleanBackup(value);
      const previous = await snapshot();
      try { await replaceAll(checked.data); }
      catch (error) {
        try { await replaceAll(previous); }
        catch { throw Object.assign(new Error('Восстановление прервано, а автоматический откат не завершился. Не закрывай программу и сохрани содержимое папки data.'), { status: 503 }); }
        throw Object.assign(new Error(`Не удалось восстановить данные. Прежние данные возвращены. ${error.message}`), { status: error.status ?? 503 });
      }
      return { restored: true, browser: checked.browser };
    },
  };
}
