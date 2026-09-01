export const STORAGE_KEY = 'steam-randomizer.v1';

export const DRAW_MODES = Object.freeze(['all', 'installed', 'uninstalled', 'unplayed', 'dormant']);
const validSteamId = id => typeof id === 'string' && /^\d{1,10}$/.test(id) && Number(id) <= 0xffffffff;
export function cleanDrawState(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const ids = list => [...new Set((Array.isArray(list) ? list : []).filter(validSteamId))].slice(0, 20000);
  const mode = typeof input.mode === 'string' && (DRAW_MODES.includes(input.mode) || /^category:[a-z][a-z0-9-]{0,31}$/.test(input.mode)) ? input.mode : 'all';
  return {
    seen: ids(input.seen),
    history: (Array.isArray(input.history) ? input.history : []).filter(entry => entry && validSteamId(entry.id) && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at))).slice(0, 30).map(entry => ({ id: entry.id, at: entry.at })),
    noRepeats: input.noRepeats !== false,
    current: validSteamId(input.current) ? input.current : null,
    mode,
  };
}

export function cleanState(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const ids = list => [...new Set((Array.isArray(list) ? list : []).filter(validSteamId))].slice(0, 20000);
  const draw = cleanDrawState(input);
  return {
    excluded: ids(input.excluded), ...draw,
    includeUninstalled: input.includeUninstalled === true,
    customPaths: [...new Set((Array.isArray(input.customPaths) ? input.customPaths : []).filter(value => typeof value === 'string' && value.length > 0 && value.length <= 1024))].slice(0, 20),
  };
}

export function matchesMode(game, mode = 'all', assignments = {}, nowSeconds = Date.now() / 1000) {
  if (mode === 'installed') return game.installed !== false;
  if (mode === 'uninstalled') return game.installed === false;
  if (mode === 'unplayed') return !Number.isFinite(game.lastPlayed) || game.lastPlayed <= 0;
  if (mode === 'dormant') return !Number.isFinite(game.lastPlayed) || game.lastPlayed <= 0 || nowSeconds - game.lastPlayed >= 90 * 86400;
  if (mode.startsWith('category:')) return (assignments[game.id] ?? []).includes(mode.slice(9));
  return true;
}

export function eligibleGames(games, state, assignments = {}) {
  const excluded = new Set(state.excluded);
  return gamesInScope(games, state).filter(game => !excluded.has(game.id) && matchesMode(game, state.mode, assignments));
}

export function gamesInScope(games, state) {
  return state.includeUninstalled ? games : games.filter(game => game.installed !== false);
}

export function gameAction(game) {
  if (!/^\d+$/.test(game.id)) throw new Error('Invalid Steam app ID');
  return game.installed === false
    ? { href: `steam://install/${game.id}`, label: 'Установить в Steam' }
    : { href: `steam://run/${game.id}`, label: 'Играть в Steam' };
}

export function randomIndex(length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffffff) throw new Error('Invalid pool size');
  const maximum = 0x100000000 - (0x100000000 % length);
  const buffer = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0] >= maximum);
  return buffer[0] % length;
}

export function drawGame(games, state, chooseIndex = randomIndex, now = new Date().toISOString(), assignments = {}) {
  const eligible = eligibleGames(games, state, assignments);
  if (!eligible.length) return null;
  const seen = new Set(state.seen);
  let pool = state.noRepeats ? eligible.filter(game => !seen.has(game.id)) : eligible;
  const newCycle = state.noRepeats && !pool.length;
  if (newCycle) {
    seen.clear();
    // Avoid the just-selected game at the boundary between complete cycles.
    pool = eligible.length > 1 ? eligible.filter(game => game.id !== state.current) : eligible;
  }
  const game = pool[chooseIndex(pool.length)];
  if (!game) throw new Error('Random index out of range');
  seen.add(game.id);
  return {
    game, newCycle,
    state: { ...state, current: game.id, seen: [...seen], history: [{ id: game.id, at: now }, ...state.history].slice(0, 30) },
  };
}
