import { getLocale, tr } from './i18n.js';

export const DISPLAY_DEFAULTS = Object.freeze({ showUninstalledSize: true, showInstalledBadge: false });

export function validDisplaySettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(DISPLAY_DEFAULTS).length
    && Object.keys(DISPLAY_DEFAULTS).every(key => typeof value[key] === 'boolean');
}

export function formatSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return tr('Размер неизвестен', 'Unknown size');
  if (bytes < 1024 ** 2) return tr('< 1 МБ', '< 1 MB');
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} ${tr('МБ', 'MB')}`;
  return `${(bytes / 1024 ** 3).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} ${tr('ГБ', 'GB')}`;
}

export function uninstalledSize(game) {
  if (game?.onlineSize?.source === 'steam-store' && Number.isSafeInteger(game.onlineSize.bytes) && game.onlineSize.bytes > 0) return `${tr('Место', 'Disk space')}: ${formatSize(game.onlineSize.bytes)}`;
  const bytes = game?.installSize?.bytes;
  if (Number.isSafeInteger(bytes) && bytes > 0) return `≈ ${formatSize(bytes)}`;
  return ['queued', 'loading'].includes(game?.onlineSizeStatus) ? tr('Проверяем размер…', 'Checking size…') : tr('Размер не указан', 'Size unavailable');
}

export function sizeSourceUrl(game) {
  return game?.onlineSize?.source === 'steam-store' && Number.isSafeInteger(game.onlineSize.bytes) && game.onlineSize.bytes > 0 && /^[1-9]\d{0,9}$/.test(game.id) ? `https://store.steampowered.com/app/${game.id}/` : '';
}

export function sizeDescription(game) {
  if (sizeSourceUrl(game)) {
    const info = game.onlineSize;
    return tr(
      `Место на диске по системным требованиям издателя в Steam Store (${info.platform}). Это не точный объём установленной игры и не размер загрузки. Проверено ${new Date(info.checkedAt).toLocaleDateString('ru-RU')}.${info.stale ? ' Сохранённые данные: обновить сейчас не удалось.' : ''}`,
      `Disk space from the publisher's Steam Store system requirements (${info.platform}). This is not the exact installed size or download size. Checked ${new Date(info.checkedAt).toLocaleDateString(getLocale())}.${info.stale ? ' Cached data is shown because it could not be refreshed.' : ''}`,
    );
  }
  if (!Number.isSafeInteger(game?.installSize?.bytes) || game.installSize.bytes <= 0) {
    if (['queued', 'loading'].includes(game?.onlineSizeStatus)) return tr('Запрашиваем системные требования в Steam Store. Розыгрыш можно продолжать.', 'Requesting system requirements from Steam Store. You can keep using the draw.');
    return game?.onlineSizeStatus === 'offline'
      ? tr('Steam Store сейчас недоступен, а сохранённого размера нет. Проверь интернет и нажми «Обновить список».', 'Steam Store is unavailable and no cached size exists. Check your connection and click “Refresh list”.')
      : tr('В доступных данных Steam размер не указан. Не подставляем объём оперативной памяти или данные другой версии игры.', 'The available Steam data does not specify a size. RAM requirements or data from another game version are not used.');
  }
  const info = game.installSize;
  const platform = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[info.platform] ?? info.platform;
  return tr(`Примерный объём основной игры на диске (${platform}, язык: ${info.language}). По локальным данным Steam, без DLC и дополнительных компонентов. Это не размер загрузки; после обновлений объём может измениться.`, `Estimated disk size of the base game (${platform}, language: ${info.language}). Based on local Steam data, without DLC or optional components. This is not download size and may change after updates.`);
}

export function heroBadges(game, settings = DISPLAY_DEFAULTS) {
  if (!game) return { status: '', size: '', description: '' };
  if (game.installed === false) return {
    status: tr('Не установлена', 'Not installed'),
    size: settings.showUninstalledSize ? uninstalledSize(game) : '',
    description: settings.showUninstalledSize ? sizeDescription(game) : '',
  };
  return { status: settings.showInstalledBadge ? [game.disk, formatSize(game.size)].filter(Boolean).join(' · ') : '', size: '', description: '' };
}

export function createDisplayClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/display-settings', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить настройки отображения.');
    if (!validDisplaySettings(result)) throw new Error('Приложение вернуло некорректные настройки. Обнови страницу.');
    return result;
  }
  return { load: () => request(), set: (key, value) => request({ key, value }) };
}
