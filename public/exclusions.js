// The app's file is authoritative. Browser storage is only a migration source
// on first use and a compatibility mirror for the other browser-only settings.
export function createExclusionsClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/exclusions', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body),
      // Small per-game writes can finish even if the user closes the tab.
      keepalive: body.action === 'set',
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить исключения.');
    if (typeof result.initialized !== 'boolean' || !Array.isArray(result.excluded) || result.excluded.length > 20000 || result.excluded.some(id => typeof id !== 'string' || !/^\d{1,10}$/.test(id) || Number(id) > 0xffffffff)) throw new Error('Приложение вернуло некорректный список исключений. Обнови страницу.');
    return result;
  }
  return {
    async load(legacy = []) {
      const result = await request();
      return result.initialized ? result.excluded : (await request({ action: 'initialize', excluded: legacy })).excluded;
    },
    async set(id, excluded) { return (await request({ action: 'set', id, excluded })).excluded; },
  };
}
