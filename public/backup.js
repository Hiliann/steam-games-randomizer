const MAX_BACKUP_BYTES = 6 * 1024 * 1024;
// Preserve canonical messages so the UI can translate and switch back to Russian.
const invalid = message => new Error(message);

function validateBrowser(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && typeof value.includeUninstalled === 'boolean'
    && Array.isArray(value.customPaths) && value.customPaths.length <= 20
    && value.customPaths.every(path => typeof path === 'string' && path.length > 0 && path.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(path));
}

export function createBackupClient(send = globalThis.fetch) {
  const preparedFiles = new WeakMap();
  async function exportBackup(browser) {
    if (!validateBrowser(browser)) throw invalid('Некорректные локальные настройки библиотек.');
    const response = await send('/api/backup', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const backup = await response.json();
    if (!response.ok) throw invalid(backup.error ?? 'Не удалось создать резервную копию.');
    backup.browser = browser;
    return backup;
  }
  async function prepareBackup(file) {
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_BACKUP_BYTES) throw invalid('Выбери файл резервной копии Play Next размером до 6 МБ.');
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { throw invalid('Файл не является корректной резервной копией JSON.'); }
    if (!validateBrowser(backup?.browser)) throw invalid('В резервной копии повреждены настройки библиотек.');
    const body = JSON.stringify(backup);
    const response = await send('/api/backup/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body, signal: AbortSignal.timeout(15000),
    });
    const summary = await response.json();
    if (!response.ok) throw invalid(summary.error ?? 'Не удалось проверить резервную копию.');
    if (!summary || typeof summary.createdAt !== 'string' || !Number.isFinite(Date.parse(summary.createdAt))
      || typeof summary.appVersion !== 'string' || summary.appVersion.length > 64
      || ['categories', 'assignedGames', 'history', 'exclusions', 'customPaths'].some(key => !Number.isSafeInteger(summary[key]) || summary[key] < 0)) {
      throw invalid('Не удалось проверить резервную копию.');
    }
    const prepared = Object.freeze({ summary: Object.freeze({ ...summary }) });
    // Keep the inspected payload private and immutable. Restoring does not read
    // the file again, so the confirmation always describes these exact bytes.
    preparedFiles.set(prepared, body);
    return prepared;
  }
  async function restorePrepared(prepared) {
    const body = preparedFiles.get(prepared);
    if (!body) throw invalid('Сначала выбери и проверь файл резервной копии.');
    const response = await send('/api/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body, signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw invalid(result.error ?? 'Не удалось восстановить резервную копию.');
    if (!validateBrowser(result.browser)) throw invalid('Приложение восстановило данные, но не вернуло настройки библиотек.');
    preparedFiles.delete(prepared);
    return result;
  }
  return { exportBackup, prepareBackup, restorePrepared, restoreBackup: async file => restorePrepared(await prepareBackup(file)) };
}
