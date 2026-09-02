function responseError(response, fallback) {
  return response.json().catch(() => ({})).then(body => { throw new Error(body.error ?? fallback); });
}

function windowsStatus(value) {
  if (!value || typeof value.supported !== 'boolean' || typeof value.desktopShortcut !== 'boolean' || typeof value.startup !== 'boolean') throw new Error('Приложение вернуло некорректные настройки Windows.');
  return { supported: value.supported, desktopShortcut: value.desktopShortcut, startup: value.startup };
}

function safeReleaseUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && /^\/Hiliann\/steam-games-randomizer\/releases\/tag\/v\d+\.\d+\.\d+$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function safeAssetUrl(value, version, checksum = false) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const suffix = checksum ? '.sha256' : '';
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && url.pathname === `/Hiliann/steam-games-randomizer/releases/download/v${version}/PlayNext-${version}-win-x64.zip${suffix}` ? url.href : null;
  } catch { return null; }
}

export function updateStatus(value) {
  if (!value || !['not-checked', 'ready', 'offline'].includes(value.status) || typeof value.currentVersion !== 'string') throw new Error('Приложение вернуло некорректные сведения об обновлении.');
  if (value.status !== 'ready') return { status: value.status, currentVersion: value.currentVersion, checkedAt: value.checkedAt ?? null };
  if (typeof value.latestVersion !== 'string' || typeof value.updateAvailable !== 'boolean') throw new Error('Приложение вернуло некорректную версию обновления.');
  return {
    status: value.status,
    currentVersion: value.currentVersion,
    latestVersion: value.latestVersion,
    updateAvailable: value.updateAvailable,
    releaseUrl: safeReleaseUrl(value.releaseUrl),
    installable: Boolean(safeAssetUrl(value.downloadUrl, value.latestVersion) && safeAssetUrl(value.checksumUrl, value.latestVersion, true)),
    checkedAt: value.checkedAt ?? null,
  };
}

export function createSystemClient(send = fetch) {
  const post = async (route, body) => {
    const response = await send(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify(body) });
    if (!response.ok) return responseError(response, 'Не удалось изменить настройку.');
    return response.json();
  };
  return {
    async loadWindows() {
      const response = await send('/api/windows-settings');
      if (!response.ok) return responseError(response, 'Не удалось прочитать настройки Windows.');
      return windowsStatus(await response.json());
    },
    async setWindows(setting, enabled) { return windowsStatus(await post('/api/windows-settings', { setting, enabled })); },
    async loadUpdate() {
      const response = await send('/api/update');
      if (!response.ok) return responseError(response, 'Не удалось прочитать сведения об обновлении.');
      return updateStatus(await response.json());
    },
    async checkUpdate(force = false) { return updateStatus(await post('/api/update', { force: force === true })); },
    async installUpdate(version) {
      const result = await post('/api/update-install', { version });
      if (!result || result.status !== 'installing' || result.targetVersion !== version) throw new Error('Приложение не подтвердило установку обновления.');
      return result;
    },
    async launchGame(id) {
      const result = await post('/api/launch', { id });
      if (!result || result.status !== 'opened' || !['run', 'install'].includes(result.action)) throw new Error('Steam не подтвердил запуск.');
      return result;
    },
  };
}
