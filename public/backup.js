const MAX_BACKUP_BYTES = 6 * 1024 * 1024;

function validateBrowser(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && typeof value.includeUninstalled === 'boolean'
    && Array.isArray(value.customPaths) && value.customPaths.length <= 20
    && value.customPaths.every(path => typeof path === 'string' && path.length > 0 && path.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(path));
}

export function createBackupClient(send = globalThis.fetch) {
  async function exportBackup(browser) {
    if (!validateBrowser(browser)) throw new Error('Некорректные локальные настройки библиотек.');
    const response = await send('/api/backup', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const backup = await response.json();
    if (!response.ok) throw new Error(backup.error ?? 'Не удалось создать резервную копию.');
    backup.browser = browser;
    return backup;
  }
  async function restoreBackup(file) {
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_BACKUP_BYTES) throw new Error('Выбери файл резервной копии Play Next размером до 6 МБ.');
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { throw new Error('Файл не является корректной резервной копией JSON.'); }
    if (!validateBrowser(backup?.browser)) throw new Error('В резервной копии повреждены настройки библиотек.');
    const response = await send('/api/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(backup), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось восстановить резервную копию.');
    if (!validateBrowser(result.browser)) throw new Error('Приложение восстановило данные, но не вернуло настройки библиотек.');
    return result;
  }
  return { exportBackup, restoreBackup };
}
