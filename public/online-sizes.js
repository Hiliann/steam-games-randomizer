// A small visible-card queue; the random draw never waits for internet access.
export function createOnlineSizesClient({ send = globalThis.fetch, onUpdate = () => {}, now = Date.now } = {}) {
  const records = new Map();
  const queue = [];
  let active = 0;
  async function run(id) {
    let result;
    try {
      const response = await send('/api/game-size', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Size lookup unavailable');
      result = await response.json();
      if (!['ready', 'not-found', 'offline', 'busy', 'disabled'].includes(result?.status)) throw new Error('Invalid size state');
      const size = result.size;
      if (size && (!Number.isSafeInteger(size.bytes) || size.bytes <= 0 || size.kind !== 'required-space' || size.source !== 'steam-store' || size.sourceUrl !== `https://store.steampowered.com/app/${id}/` || !Number.isSafeInteger(size.checkedAt) || !['windows', 'linux', 'macos'].includes(size.platform))) throw new Error('Invalid size response');
    } catch { result = { status: 'offline', size: null }; }
    records.set(id, { ...result, expires: now() + (result.status === 'ready' ? 3600000 : result.status === 'not-found' ? 86400000 : 30000) });
    active--;
    onUpdate(id, result);
    pump();
  }
  function pump() {
    while (active < 2 && queue.length) {
      const id = queue.shift(); active++;
      records.set(id, { status: 'loading', expires: Infinity });
      void run(id);
    }
  }
  return {
    request(id, priority = false) {
      if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 0xffffffff) return;
      const record = records.get(id);
      if (record?.expires > now()) {
        if (priority && record.status === 'queued') { queue.splice(queue.indexOf(id), 1); queue.unshift(id); }
        return;
      }
      records.set(id, { status: 'queued', expires: Infinity });
      if (priority) queue.unshift(id); else queue.push(id);
      pump();
    },
    get: id => records.get(id),
    clearQueue() {
      for (const id of queue) records.delete(id);
      queue.length = 0;
    },
    retryUnavailable() {
      for (const [id, item] of records) if (['offline', 'busy', 'disabled'].includes(item.status)) records.delete(id);
    },
  };
}
