import { STORE_LANGUAGES } from './ui-settings.js';

const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;

function validResult(result, id, language) {
  return result && ['ready', 'not-found', 'offline', 'busy'].includes(result.status)
    && (result.description === null || (typeof result.description === 'string' && result.description.length > 0 && result.description.length <= 500))
    && result.sourceUrl === `https://store.steampowered.com/app/${id}/`
    && result.language === STORE_LANGUAGES[language];
}

export function createDescriptionsClient({ send = globalThis.fetch, onUpdate = () => {}, now = Date.now } = {}) {
  const records = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  function pump() {
    while (active < 2 && queue.length) { active++; void queue.shift()(); }
  }
  return {
    request(id, language = 'en', priority = false) {
      if (!validId(id) || !Object.hasOwn(STORE_LANGUAGES, language)) return;
      const key = `${language}:${id}`;
      const record = records.get(key);
      if (pending.has(key)) {
        const task = pending.get(key), index = queue.indexOf(task);
        if (priority && index > 0) { queue.splice(index, 1); queue.unshift(task); }
        return;
      }
      if (record?.expires > now()) return;
      const task = async () => {
        let result;
        try {
          const response = await send('/api/game-description', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
            body: JSON.stringify({ id, language }), signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error('Description lookup unavailable');
          result = await response.json();
          if (!validResult(result, id, language)) throw new Error('Invalid description response');
        } catch { result = { status: 'offline', description: null, sourceUrl: `https://store.steampowered.com/app/${id}/`, language: STORE_LANGUAGES[language] }; }
        const ttl = result.status === 'ready' ? 3600000 : result.status === 'not-found' ? 86400000 : 30000;
        records.set(key, { ...result, expires: now() + ttl });
        pending.delete(key);
        active--;
        try { onUpdate(id, language, result); } finally { pump(); }
      };
      task.key = key;
      pending.set(key, task);
      records.set(key, { status: 'loading', description: null, expires: Infinity });
      if (priority) queue.unshift(task); else queue.push(task);
      pump();
    },
    get: (id, language = 'en') => records.get(`${language}:${id}`),
    clearQueue() {
      for (const task of queue) { pending.delete(task.key); records.delete(task.key); }
      queue.length = 0;
    },
  };
}
