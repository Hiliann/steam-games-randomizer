import { tr } from './i18n.js';

// Genres and play modes confirmed by Steam Store. A game without a confirmed
// entry is "unknown": it is never guessed into a genre or a play mode.
export const STORE_FEATURES = Object.freeze(['single', 'multi', 'coop']);
export const STORE_STATES = Object.freeze(['idle', 'loading', 'blocked', 'disabled']);
const validGenreId = id => typeof id === 'string' && /^[1-9]\d{0,3}$/.test(id);
const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 64 && !/[\u0000-\u001f\u007f<>]/.test(name);

export function cleanStoreEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.genres) || value.genres.length > 30 || !value.genres.every(validGenreId)) return null;
  const features = value.features;
  if (features !== null && (!features || typeof features !== 'object' || Array.isArray(features) || !STORE_FEATURES.every(key => typeof features[key] === 'boolean'))) return null;
  return { genres: [...new Set(value.genres)], features: features && { single: features.single, multi: features.multi, coop: features.coop } };
}

export function cleanGenreNames(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const names = {};
  for (const [id, name] of Object.entries(value).slice(0, 500)) if (validGenreId(id) && validName(name)) names[id] = name;
  return names;
}

// Steam's English genre names are stored; common game genres get a local label.
const GENRE_LABELS = {
  1: ['Экшен', 'Action'], 2: ['Стратегия', 'Strategy'], 3: ['Ролевая', 'RPG'], 4: ['Казуальная', 'Casual'], 9: ['Гонки', 'Racing'],
  18: ['Спорт', 'Sports'], 23: ['Инди', 'Indie'], 25: ['Приключение', 'Adventure'], 28: ['Симулятор', 'Simulation'],
  29: ['MMO', 'Massively Multiplayer'], 37: ['Бесплатная', 'Free to Play'], 70: ['Ранний доступ', 'Early Access'],
  51: ['Анимация и моделирование', 'Animation & Modeling'], 52: ['Работа со звуком', 'Audio Production'], 53: ['Дизайн и иллюстрация', 'Design & Illustration'],
  54: ['Обучение', 'Education'], 55: ['Обработка фото', 'Photo Editing'], 56: ['Обучение работе с ПО', 'Software Training'], 57: ['Утилиты', 'Utilities'],
  58: ['Видеомонтаж', 'Video Production'], 59: ['Веб-публикации', 'Web Publishing'], 60: ['Разработка игр', 'Game Development'],
  71: ['Сексуальный контент', 'Sexual Content'], 72: ['Обнажённая натура', 'Nudity'], 73: ['Насилие', 'Violent'], 74: ['Жестокость', 'Gore'],
  81: ['Документальные', 'Documentary'], 84: ['Обучающие', 'Tutorial'],
};
export function genreLabel(id, names = {}) {
  const local = GENRE_LABELS[id];
  return local ? tr(local[0], local[1]) : names[id] ?? tr(`Жанр ${id}`, `Genre ${id}`);
}
export function featureLabel(feature) {
  if (feature === 'single') return tr('Одиночная игра', 'Single-player');
  if (feature === 'multi') return tr('Мультиплеер', 'Multiplayer');
  if (feature === 'coop') return tr('Кооператив', 'Co-op');
  return tr('Режим не известен', 'Mode unknown');
}

export function matchesGenre(game, genre = 'all') {
  if (genre === 'all') return true;
  if (genre === 'unknown') return !game.store;
  return !!game.store?.genres.includes(genre);
}
export function matchesFeature(game, feature = 'all') {
  if (feature === 'all') return true;
  if (feature === 'unknown') return !game.store?.features;
  return game.store?.features?.[feature] === true;
}

export function cleanStoreProgress(value) {
  const count = number => Number.isSafeInteger(number) && number >= 0 && number <= 1000000;
  if (!value || !STORE_STATES.includes(value.state) || !['total', 'known', 'unavailable', 'pending'].every(key => count(value[key]))) return null;
  return { state: value.state, total: value.total, known: value.known, unavailable: value.unavailable, pending: value.pending };
}

export function storeProgressText(progress) {
  if (!progress || !progress.total) return '';
  const { state, known, total, unavailable } = progress;
  const done = known + unavailable;
  if (state === 'disabled') return tr(`Жанры и режимы: ${done} из ${total}. Загрузка приостановлена: сведения из Steam Store выключены в настройках.`, `Genres and modes: ${done} of ${total}. Loading is paused because Steam Store information is turned off in Settings.`);
  if (state === 'blocked') return tr(`Жанры и режимы: ${done} из ${total}. Steam Store временно ограничил запросы, продолжим позже.`, `Genres and modes: ${done} of ${total}. Steam Store is limiting requests; loading will resume later.`);
  if (state === 'loading') return tr(`Жанры и режимы: ${done} из ${total}. Загружаем в фоне из Steam Store…`, `Genres and modes: ${done} of ${total}. Loading in the background from Steam Store…`);
  if (done < total) return tr(`Жанры и режимы известны для ${done} из ${total} игр. Остальные проверим при следующем обновлении списка.`, `Genres and modes are known for ${done} of ${total} games. The rest will be checked on the next refresh.`);
  return '';
}

export function createStoreDetailsClient(send = globalThis.fetch) {
  return {
    async load(since = 0) {
      const response = await send(`/api/store-details?since=${Number.isSafeInteger(since) && since >= 0 ? since : 0}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? tr('Не удалось загрузить жанры.', 'Could not load genres.'));
      const progress = cleanStoreProgress(result.progress);
      if (!progress || !Number.isSafeInteger(result.revision) || result.revision < 0 || !result.entries || typeof result.entries !== 'object' || Array.isArray(result.entries)) throw new Error(tr('Приложение вернуло некорректные жанры.', 'The app returned invalid genres.'));
      const entries = {};
      for (const [id, entry] of Object.entries(result.entries)) {
        if (!/^\d{1,10}$/.test(id)) continue;
        entries[id] = entry === null ? null : cleanStoreEntry(entry);
      }
      return { revision: result.revision, progress, entries, names: cleanGenreNames(result.names) };
    },
  };
}
