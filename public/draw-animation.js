const validId = id => typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xffffffff;

// Warm only this draw's handful of images. Missing artwork never holds up a draw.
export function createHeroArtwork({ image, version = '3', makeImage = () => new Image(), schedule = setTimeout, cancel = clearTimeout, limit = 12 } = {}) {
  const records = new Map();
  let displayedId = null, revision = 0;
  function load(url) {
    return new Promise(resolve => {
      const candidate = makeImage();
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true; cancel(timer); candidate.onload = candidate.onerror = null;
        resolve(ok ? { url, image: candidate } : null);
      };
      const timer = schedule(() => finish(false), 1500);
      candidate.onload = async () => {
        try { if (candidate.decode) await candidate.decode(); finish(true); } catch { finish(false); }
      };
      candidate.onerror = () => finish(false);
      candidate.decoding = 'async'; candidate.src = url;
    });
  }
  function request(id) {
    if (!validId(id)) return { task: Promise.resolve(null), value: null };
    const cached = records.get(id);
    if (cached) { records.delete(id); records.set(id, cached); return cached; }
    const entry = { value: undefined, task: null };
    entry.task = (async () => await load(`/art/${id}/hero?v=${version}`) ?? await load(`/art/${id}/cover?v=${version}`))().then(value => { entry.value = value; return value; });
    records.set(id, entry);
    while (records.size > limit) records.delete(records.keys().next().value);
    return entry;
  }
  function display(record, id, token) {
    if (token !== revision || !record) return;
    const ready = record.image;
    ready.id = image.id; ready.className = image.className; ready.alt = image.alt;
    ready.dataset.gameId = id; ready.dataset.artwork = record.url.includes('/cover?') ? 'cover' : 'hero';
    ready.hidden = false;
    // Swap a decoded element, not a new src awaiting another rendering cycle.
    if (ready !== image) image.replaceWith(ready);
    image = ready;
  }
  return {
    preload: games => Promise.all([...new Set(games.map(game => game.id))].map(id => request(id).task)),
    show(game) {
      const id = game?.id ?? null;
      if (id === displayedId) return;
      displayedId = id;
      const token = ++revision;
      const entry = request(id);
      if (entry.value) { display(entry.value, id, token); return; }
      // Do not clear the previous cached bitmap; detach it and show a clean placeholder.
      const blank = image.cloneNode(false);
      blank.hidden = true; blank.removeAttribute('src'); blank.dataset.gameId = id ?? '';
      image.replaceWith(blank); image = blank;
      if (validId(id)) void entry.task.then(record => display(record, id, token));
    },
    reset() { records.clear(); displayedId = null; revision++; image.hidden = true; image.removeAttribute('src'); },
  };
}

export async function playDrawFrames(sequence, { prepare = () => {}, render, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), schedule = setTimeout, cancel = clearTimeout, preparationMs = 450 } = {}) {
  if (!sequence.length) return;
  let timer;
  try {
    await Promise.race([
      Promise.resolve(prepare()).catch(() => {}),
      new Promise(resolve => { timer = schedule(resolve, preparationMs); }),
    ]);
  } finally { cancel(timer); }
  for (const [index, game] of sequence.entries()) {
    render(game);
    await wait(110 + index * 30);
  }
}
