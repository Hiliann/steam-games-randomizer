const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;

function validResult(result, id, language) {
  return result && ['ready', 'not-found', 'offline', 'busy'].includes(result.status)
    && (result.description === null || (typeof result.description === 'string' && result.description.length > 0 && result.description.length <= 500))
    && result.sourceUrl === `https://store.steampowered.com/app/${id}/`
    && result.language === (language === 'ru' ? 'russian' : 'english');
}

export function createDescriptionsClient({ send = globalThis.fetch, onUpdate = () => {}, now = Date.now } = {}) {
  const records = new Map();
  const pending = new Map();
  return {
    request(id, language = 'en') {
      if (!validId(id) || !['ru', 'en'].includes(language)) return;
      const key = `${language}:${id}`;
      const record = records.get(key);
      if (record?.expires > now() || pending.has(key)) return;
      const task = (async () => {
        let result;
        try {
          const response = await send('/api/game-description', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
            body: JSON.stringify({ id, language }), signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error('Description lookup unavailable');
          result = await response.json();
          if (!validResult(result, id, language)) throw new Error('Invalid description response');
        } catch { result = { status: 'offline', description: null, sourceUrl: `https://store.steampowered.com/app/${id}/`, language: language === 'ru' ? 'russian' : 'english' }; }
        const ttl = result.status === 'ready' ? 3600000 : result.status === 'not-found' ? 86400000 : 30000;
        records.set(key, { ...result, expires: now() + ttl });
        pending.delete(key);
        onUpdate(id, language, result);
      })();
      pending.set(key, task);
      records.set(key, { status: 'loading', description: null, expires: Infinity });
    },
    get: (id, language = 'en') => records.get(`${language}:${id}`),
  };
}
