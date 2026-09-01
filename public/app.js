import { STORAGE_KEY, cleanState, cleanDrawState, gamesInScope, gameAction, eligibleGames, drawGame } from './randomizer.js';
import { createExclusionsClient } from './exclusions.js';
import { DISPLAY_DEFAULTS, createDisplayClient, formatSize, uninstalledSize, sizeDescription, sizeSourceUrl, heroBadges } from './display.js';
import { createOnlineSizesClient } from './online-sizes.js';
import { createProfileClient } from './profile.js';

const $ = id => document.getElementById(id);
// Bypass covers cached by older versions that did not resolve nested Steam assets.
const ARTWORK_VERSION = '2';
let state = cleanState();
try { state = cleanState(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')); }
catch { $('storage-banner').hidden = false; }
let games = [];
let snapshot = null;
let filter = 'included';
let busy = false;
let scanning = false;
let exclusionsReady = false;
let savingExclusion = false;
const exclusionsClient = createExclusionsClient();
const displayClient = createDisplayClient();
const profileClient = createProfileClient();
let displaySettings = { ...DISPLAY_DEFAULTS };
let displayReady = false;
let displayPending = false;
let displayMessage = 'Загружаем настройки…';
let profile = { initialized: false, revision: 0, categories: [], assignments: {}, draw: cleanDrawState(state) };
let profileReady = false;
let profilePending = false;
let categoryFilter = 'all';
let categoryGameId = null;
let previewId = state.current;
let toastTimer;
const scopedGames = () => gamesInScope(games, state);
const eligible = () => eligibleGames(games, state, profile.assignments);
let heroGameId = null;
let cacheWarningShown = false;
const onlineSizes = createOnlineSizesClient({ onUpdate(id, result) {
  const game = games.find(game => game.id === id);
  if (!game) return;
  if (result.size) game.onlineSize = result.size;
  game.onlineSizeStatus = result.status;
  // Update just the size labels, preserving checkbox focus and draw animation.
  for (const node of document.querySelectorAll(`[data-size-id="${id}"]`)) renderCardSize(game, node);
  if (heroGameId === id) renderHeroBadges(game);
  if (result.cacheSaved === false && !cacheWarningShown) { cacheWarningShown = true; toast('Размер получен, но не сохранён на диск. Проверь доступ к папке data приложения.'); }
} });
const sizeObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    sizeObserver.unobserve(entry.target);
    requestOnlineSize(games.find(game => game.id === entry.target.dataset.sizeId));
  }
}, { rootMargin: '180px' }) : null;

function requestOnlineSize(game, priority = false) {
  if (!game || game.installed !== false || !displayReady || !displaySettings.showUninstalledSize || !state.includeUninstalled || scanning) return;
  onlineSizes.request(game.id, priority);
  syncOnlineSize(game);
  for (const node of document.querySelectorAll(`[data-size-id="${game.id}"]`)) renderCardSize(game, node);
  if (heroGameId === game.id) renderHeroBadges(game);
}
function syncOnlineSize(game) {
  const record = onlineSizes.get(game.id);
  if (record?.size) game.onlineSize = record.size;
  if (record) game.onlineSizeStatus = record.status;
}
function renderCardSize(game, node) {
  syncOnlineSize(game);
  const enabled = game.installed === false && displaySettings.showUninstalledSize;
  node.textContent = game.installed === false ? enabled ? uninstalledSize(game) : 'В библиотеке' : formatSize(game.size);
  node.title = enabled ? sizeDescription(game) : '';
  const url = enabled ? sizeSourceUrl(game) : '';
  if (url) {
    const link = element('a', 'size-source', 'Steam');
    link.href = url; link.target = '_blank'; link.rel = 'noreferrer noopener';
    link.setAttribute('aria-label', `Источник размера ${game.name} в Steam`);
    node.append(link);
  }
}
function renderHeroBadges(game) {
  const badges = heroBadges(game, displaySettings);
  $('hero-disk').textContent = badges.status;
  $('hero-disk').hidden = !badges.status;
  $('hero-size').textContent = badges.size;
  $('hero-size').title = badges.description;
  $('hero-size').hidden = !badges.size;
  const source = game?.installed === false && displaySettings.showUninstalledSize ? sizeSourceUrl(game) : '';
  $('hero-size-source').hidden = !source;
  if (source) $('hero-size-source').href = source; else $('hero-size-source').removeAttribute('href');
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { $('storage-banner').hidden = false; }
}
function drawSnapshot(value = state) {
  return cleanDrawState({ mode: value.mode, noRepeats: value.noRepeats, seen: value.seen, history: value.history, current: value.current });
}
function applyProfile(next) {
  profile = next;
  const browserOnly = { excluded: state.excluded, includeUninstalled: state.includeUninstalled, customPaths: state.customPaths };
  state = cleanState({ ...state, ...next.draw, ...browserOnly });
  previewId = state.current;
  save();
}
function profileFailure(error, prefix = 'Не удалось загрузить категории и историю.') {
  profileReady = false;
  const detail = error instanceof TypeError ? 'Проверь, что приложение запущено.' : error.message;
  $('error-banner').textContent = `${prefix} ${detail} Нажми «Обновить список», чтобы перечитать данные.`;
  $('error-banner').hidden = false;
}
async function loadProfile() {
  if (profilePending) return false;
  profilePending = true;
  renderCounts();
  try {
    applyProfile(await profileClient.load(drawSnapshot()));
    profileReady = true;
    return true;
  } catch (error) {
    profileFailure(error);
    return false;
  } finally {
    profilePending = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid();
    if ($('categories-dialog').open) renderCategoriesDialog();
  }
}
async function updateDraw(update, successMessage) {
  if (!profileReady || profilePending || busy || scanning) return false;
  const next = cleanState({ ...state, ...update });
  profilePending = true;
  renderCounts(); renderHistory();
  try {
    applyProfile(await profileClient.replaceDraw(profile.revision, drawSnapshot(next)));
    $('error-banner').hidden = true;
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    profileFailure(error, 'Не удалось подтвердить сохранение истории или режима выбора.');
    return false;
  } finally {
    profilePending = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid();
  }
}
async function loadExclusions() {
  exclusionsReady = false;
  state.excluded = await exclusionsClient.load(state.excluded);
  exclusionsReady = true;
  save();
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function renderDisplaySettings() {
  for (const key of Object.keys(DISPLAY_DEFAULTS)) {
    $(key).checked = displaySettings[key];
    $(key).disabled = !displayReady || displayPending;
  }
  $('display-status').textContent = displayMessage;
  $('retry-display').hidden = displayReady || displayPending;
  if (!displaySettings.showUninstalledSize) onlineSizes.clearQueue();
}
async function loadDisplaySettings() {
  if (displayPending) return;
  displayPending = true;
  displayMessage = 'Загружаем настройки…';
  renderDisplaySettings();
  try {
    displaySettings = await displayClient.load();
    displayReady = true;
    displayMessage = 'Настройки сохраняются автоматически в папке приложения.';
  } catch (error) {
    displayReady = false;
    displayMessage = error instanceof TypeError ? 'Нет связи с приложением. Запусти его и повтори загрузку настроек.' : error.message;
  } finally {
    displayPending = false;
    renderDisplaySettings(); renderHero(); renderGrid();
  }
}
async function setDisplaySetting(key, value) {
  if (!displayReady || displayPending) return;
  displayPending = true;
  displayMessage = 'Сохраняем…';
  renderDisplaySettings();
  try {
    displaySettings = await displayClient.set(key, value);
    displayMessage = 'Настройки сохранены.';
  } catch (error) {
    // A lost acknowledgement may still mean a successful write. Re-read first.
    displayReady = false;
    displayMessage = `Не удалось подтвердить сохранение. ${error instanceof TypeError ? 'Проверь, что приложение запущено.' : error.message} Нажми «Повторить загрузку».`;
  } finally {
    displayPending = false;
    renderDisplaySettings(); renderHero(); renderGrid();
  }
}
function lastPlayedLabel(game) {
  if (!game.lastPlayed) return 'Самое время познакомиться поближе.';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - game.lastPlayed) / 86400));
  if (days === 0) return 'Ты уже заглядывал сюда сегодня. Продолжим?';
  return `Последний запуск: ${new Date(game.lastPlayed * 1000).toLocaleDateString('ru-RU')}. Почему бы не вернуться?`;
}
function artwork(game, kind = 'cover') {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = `/art/${game.id}/${kind}?v=${ARTWORK_VERSION}`;
  img.addEventListener('error', () => { img.hidden = true; });
  return img;
}
function gameCategories(gameId) {
  const ids = new Set(profile.assignments[gameId] ?? []);
  return profile.categories.filter(category => ids.has(category.id));
}
function categoryBadge(category) {
  const badge = element('span', `category-badge category-${category.color}`, category.name);
  badge.title = `Категория: ${category.name}`;
  return badge;
}
function renderCategoryBadges(container, gameId) {
  const categories = gameCategories(gameId);
  container.replaceChildren(...categories.map(categoryBadge));
  container.hidden = !categories.length;
}
function modeLabel(mode = state.mode) {
  if (mode === 'installed') return 'Только установленные';
  if (mode === 'uninstalled') return 'Только неустановленные';
  if (mode === 'unplayed') return 'Ещё не запускались';
  if (mode === 'dormant') return 'Не запускались 90 дней';
  if (mode.startsWith('category:')) return profile.categories.find(category => category.id === mode.slice(9))?.name ?? 'Категория';
  return 'Все участвующие';
}
function renderCategorySelectors() {
  const drawValue = state.mode;
  const drawOptions = [
    ['all', 'Все участвующие'],
    ['installed', 'Только установленные'],
    ['uninstalled', 'Только неустановленные'],
    ['unplayed', 'Ещё не запускались'],
    ['dormant', 'Не запускались 90 дней'],
  ];
  const drawFragment = document.createDocumentFragment();
  for (const [value, label] of drawOptions) {
    const option = element('option', '', label); option.value = value; drawFragment.append(option);
  }
  if (profile.categories.length) {
    const group = document.createElement('optgroup'); group.label = 'Категории';
    for (const category of profile.categories) {
      const option = element('option', '', category.name); option.value = `category:${category.id}`; group.append(option);
    }
    drawFragment.append(group);
  }
  $('draw-mode').replaceChildren(drawFragment);
  $('draw-mode').value = [...$('draw-mode').options].some(option => option.value === drawValue) ? drawValue : 'all';

  const filterFragment = document.createDocumentFragment();
  const all = element('option', '', 'Все категории'); all.value = 'all'; filterFragment.append(all);
  for (const category of profile.categories) {
    const option = element('option', '', category.name); option.value = category.id; filterFragment.append(option);
  }
  if (categoryFilter !== 'all' && !profile.categories.some(category => category.id === categoryFilter)) categoryFilter = 'all';
  $('category-filter').replaceChildren(filterFragment);
  $('category-filter').value = categoryFilter;
  $('draw-mode').disabled = !profileReady || profilePending || busy || scanning;
  $('category-filter').disabled = !profileReady || profilePending || scanning;
}
function renderCounts() {
  const drawingPool = eligible();
  const played = drawingPool.filter(game => state.seen.includes(game.id)).length;
  const scoped = scopedGames();
  const excluded = new Set(state.excluded);
  const participating = scoped.filter(game => !excluded.has(game.id));
  $('installed-count').textContent = snapshot?.installedCount ?? games.filter(game => game.installed !== false).length;
  const count = snapshot?.libraries.filter(library => library.available && library.count).length ?? 0;
  $('library-count').textContent = `Библиотек: ${count}`;
  $('library-total').textContent = scoped.length;
  $('included-count').textContent = participating.length;
  $('all-count').textContent = scoped.length;
  $('excluded-count').textContent = scoped.length - eligible.length;
  $('include-uninstalled').checked = state.includeUninstalled;
  $('include-uninstalled').disabled = busy || scanning || savingExclusion;
  $('library-kicker').textContent = state.includeUninstalled ? 'НА КОМПЬЮТЕРЕ И В ТВОЁМ STEAM' : 'ВСЁ УЖЕ НА ТВОЁМ КОМПЬЮТЕРЕ';
  renderScopeNote();
  $('no-repeats').checked = state.noRepeats;
  $('no-repeats').disabled = !profileReady || profilePending || busy || scanning;
  $('draw-button').disabled = !profileReady || profilePending || busy || scanning || savingExclusion || !exclusionsReady || !drawingPool.length;
  $('refresh-button').disabled = busy || scanning || savingExclusion;
  $('exclusions-status').textContent = savingExclusion ? 'Сохраняем исключения…' : exclusionsReady ? 'Исключения сохранены в приложении' : 'Исключения ещё не загружены';
  $('reset-cycle').disabled = !profileReady || profilePending || busy || !state.seen.length;
  $('cycle-label').textContent = state.noRepeats ? `Выпало ${played} из ${drawingPool.length} в этом круге` : 'Повторы разрешены';
  $('cycle-progress').max = Math.max(1, drawingPool.length);
  $('cycle-progress').value = state.noRepeats ? played : 0;
  $('cycle-progress').hidden = !state.noRepeats;
  $('reset-cycle').hidden = !state.noRepeats;
  $('pool-note').textContent = !profileReady ? 'Загружаем сохранённые категории и историю.' : !scoped.length ? 'Добавь библиотеку, чтобы начать.' : !drawingPool.length ? `В режиме «${modeLabel()}» нет подходящих игр.` : state.noRepeats && played === drawingPool.length ? 'Следующий выбор начнёт новый круг.' : `${modeLabel()}: ${drawingPool.length}. У каждой игры равный шанс.`;
  $('draw-label').textContent = busy ? 'Выбираем…' : state.current ? 'Предложить другую' : 'Выбрать игру';
  $('online-size-note').hidden = !state.includeUninstalled || !displaySettings.showUninstalledSize;
  renderCategorySelectors();
}
function renderScopeNote() {
  const info = snapshot?.ownedLibrary;
  let message = 'Сейчас выбираем только из установленных игр.';
  if (state.includeUninstalled) {
    if (scanning) message = 'Читаем локальную библиотеку аккаунта Steam…';
    else if (info?.status === 'ready' || info?.status === 'partial') {
      message = `${info.accountName} · добавлено неустановленных: ${info.addedCount}. ${info.message}`;
    } else message = info?.message ?? 'Для загрузки библиотеки нажми «Обновить список».';
  }
  $('scope-note').textContent = message;
}
function renderHero() {
  const scoped = scopedGames();
  const selected = scoped.find(game => game.id === previewId);
  const game = selected ?? scoped.find(item => !state.excluded.includes(item.id)) ?? scoped[0];
  heroGameId = game?.id ?? null;
  if (game) syncOnlineSize(game);
  const image = $('hero-image');
  if (game) {
    const url = `/art/${game.id}/hero?v=${ARTWORK_VERSION}`;
    if (image.getAttribute('src') !== url) { image.hidden = true; image.src = url; }
  } else { image.removeAttribute('src'); image.hidden = true; }
  renderHeroBadges(game);
  renderCategoryBadges($('hero-categories'), game?.id);
  requestOnlineSize(game, true);
  $('play-button').hidden = !selected;
  $('exclude-current').hidden = !selected || state.excluded.includes(selected.id);
  $('exclude-current').disabled = busy || scanning || savingExclusion || !exclusionsReady;
  if (selected) {
    $('spotlight-tag').textContent = 'СЕГОДНЯ В ИГРЕ';
    $('hero-kicker').textContent = state.excluded.includes(selected.id) ? 'ИСКЛЮЧЕНА ИЗ БУДУЩИХ РОЗЫГРЫШЕЙ' : selected.installed === false ? 'СЛУЧАЙ ВЫБРАЛ. НАЧНЁМ С УСТАНОВКИ.' : 'СЛУЧАЙ ВЫБРАЛ. ОСТАЛОСЬ НАЖАТЬ PLAY.';
    $('hero-title').textContent = selected.name;
    $('hero-description').textContent = selected.installed === false ? 'Игра есть в библиотеке аккаунта, но не установлена на этом компьютере. Steam предложит выбрать диск и начать загрузку.' : selected.updateRequired ? 'Игра установлена. Перед запуском Steam может предложить обновление.' : lastPlayedLabel(selected);
    const action = gameAction(selected);
    $('play-button').href = action.href;
    $('play-label').textContent = action.label;
    $('cover-caption').textContent = 'Обложка из твоей библиотеки Steam';
  } else {
    $('spotlight-tag').textContent = 'ТВОЯ СЛЕДУЮЩАЯ ИГРА';
    $('hero-kicker').textContent = scoped.length ? 'БИБЛИОТЕКА ПОЛНА ВОЗМОЖНОСТЕЙ' : 'НАЧНЁМ С ТВОЕЙ БИБЛИОТЕКИ';
    $('hero-title').textContent = scoped.length ? 'Вечер свободен. Игра найдётся.' : 'Твоя следующая игра уже где-то рядом.';
    $('hero-description').textContent = scoped.length ? 'Нажми «Выбрать игру» - мы найдём, во что погрузиться сегодня.' : 'Если Steam установлен в необычной папке, укажи её в разделе «Библиотеки».';
    $('play-button').removeAttribute('href');
    $('cover-caption').textContent = game ? `На обложке: ${game.name}` : '';
  }
}
$('hero-image').addEventListener('load', () => { $('hero-image').hidden = false; });
$('hero-image').addEventListener('error', () => { $('hero-image').hidden = true; $('cover-caption').textContent = ''; });

async function setExcluded(id, excluded) {
  if (busy || scanning || savingExclusion || !exclusionsReady) return false;
  const previous = state.excluded;
  const ids = new Set(state.excluded);
  if (excluded) ids.add(id); else ids.delete(id);
  state.excluded = [...ids];
  savingExclusion = true;
  renderCounts(); renderGrid(); renderHero();
  try {
    state.excluded = await exclusionsClient.set(id, excluded);
    save();
    $('error-banner').hidden = true;
    return true;
  } catch (error) {
    state.excluded = previous;
    exclusionsReady = false; // The response may have been lost after a successful write.
    save();
    $('error-banner').textContent = `Не удалось подтвердить сохранение исключения. ${error instanceof TypeError ? 'Запусти приложение, если оно закрыто.' : error.message} Нажми «Обновить список», чтобы перечитать сохранённые данные.`;
    $('error-banner').hidden = false;
    return false;
  } finally {
    savingExclusion = false;
    renderCounts(); renderGrid(); renderHero();
  }
}
function renderGrid() {
  sizeObserver?.disconnect();
  onlineSizes.clearQueue();
  $('online-size-note').hidden = !state.includeUninstalled || !displaySettings.showUninstalledSize;
  const term = $('search-input').value.trim().toLocaleLowerCase('ru');
  const excluded = new Set(state.excluded);
  const scoped = scopedGames();
  const visible = scoped.filter(game => (filter === 'all' || (filter === 'excluded' ? excluded.has(game.id) : !excluded.has(game.id))) && (categoryFilter === 'all' || (profile.assignments[game.id] ?? []).includes(categoryFilter)) && game.name.toLocaleLowerCase('ru').includes(term));
  const fragment = document.createDocumentFragment();
  for (const game of visible) {
    const isExcluded = excluded.has(game.id);
    const card = element('article', 'game-card' + (isExcluded ? ' excluded' : ''));
    const art = element('div', 'game-art');
    const fallback = element('div', 'game-placeholder');
    fallback.append(icon('game'), element('span', '', game.name));
    fallback.setAttribute('aria-hidden', 'true');
    art.append(fallback, artwork(game), element('span', 'card-disk', game.installed === false ? 'В Steam' : game.disk));
    const title = element('h3', '', game.name); title.title = game.name;
    const meta = element('div', 'game-meta');
    const size = element('span', 'game-size');
    size.dataset.sizeId = game.id;
    renderCardSize(game, size);
    meta.append(size, element('span', '', game.installed === false ? 'Не установлена' : game.updateRequired ? 'Обновление' : 'Установлена'));
    const toggle = element('label', 'game-toggle');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = !isExcluded; checkbox.disabled = busy || scanning || savingExclusion || !exclusionsReady;
    checkbox.setAttribute('aria-label', `Участвует в розыгрыше: ${game.name}`);
    checkbox.addEventListener('change', async () => {
      const nextId = visible[visible.indexOf(game) + 1]?.id ?? visible[visible.indexOf(game) - 1]?.id;
      await setExcluded(game.id, !checkbox.checked);
      // Restore a useful keyboard target after rebuilding the filtered list.
      const target = document.getElementById(`toggle-${game.id}`) ?? document.getElementById(`toggle-${nextId}`);
      target?.focus({ preventScroll: true });
    });
    checkbox.id = `toggle-${game.id}`;
    toggle.append(checkbox, element('span', '', isExcluded ? 'Исключена' : 'Участвует'));
    const categoryRow = element('div', 'card-category-row');
    const badges = element('div', 'category-badges card-category-badges');
    renderCategoryBadges(badges, game.id);
    const editCategories = element('button', 'card-category-button');
    editCategories.type = 'button'; editCategories.title = `Категории: ${game.name}`;
    editCategories.setAttribute('aria-label', `Изменить категории игры ${game.name}`);
    editCategories.disabled = !profileReady || profilePending;
    editCategories.append(icon('tag'), element('span', '', 'Категории'));
    editCategories.addEventListener('click', () => openCategories(game.id));
    categoryRow.append(badges, editCategories);
    card.append(art, title, meta, categoryRow, toggle);
    fragment.append(card);
  }
  $('game-grid').replaceChildren(fragment);
  if (displaySettings.showUninstalledSize && state.includeUninstalled) {
    requestOnlineSize(games.find(game => game.id === heroGameId), true);
    if (sizeObserver) {
      for (const node of $('game-grid').querySelectorAll('[data-size-id]')) {
        if (visible.some(game => game.id === node.dataset.sizeId && game.installed === false)) sizeObserver.observe(node);
      }
    } else visible.filter(game => game.installed === false).slice(0, 12).forEach(game => requestOnlineSize(game));
  }
  $('game-grid').setAttribute('aria-busy', String(scanning));
  $('empty-state').hidden = !!visible.length;
  $('search-note').hidden = !term && categoryFilter === 'all';
  $('visible-count').textContent = `Показано ${visible.length} из ${scoped.length} игр`;
  if (!visible.length) {
    $('empty-title').textContent = !scoped.length ? 'Игры пока не найдены' : term || categoryFilter !== 'all' ? 'Ничего не нашлось' : filter === 'excluded' ? 'Все игры в деле' : 'Все игры исключены';
    $('empty-description').textContent = !scoped.length ? state.includeUninstalled ? 'Открой библиотеку в Steam онлайн и обнови список. При необходимости укажи папку клиента Steam.' : 'Укажи папку Steam или SteamLibrary. Сейчас учитываем только установки на диске.' : term || categoryFilter !== 'all' ? 'Сбрось поиск или выбери другую категорию.' : filter === 'excluded' ? 'Исключённые игры появятся здесь. Сейчас каждая может выпасть.' : 'Открой вкладку «Исключены» и верни игры в розыгрыш.';
    $('empty-action').textContent = !scoped.length ? 'Указать папку' : term || categoryFilter !== 'all' ? 'Сбросить фильтры' : 'Показать все игры';
  }
}
function renderHistory() {
  const scoped = scopedGames();
  const entries = state.history.map(entry => ({ ...entry, game: scoped.find(game => game.id === entry.id) })).filter(entry => entry.game).slice(0, 7);
  const fragment = document.createDocumentFragment();
  for (const [i, entry] of entries.entries()) {
    const button = element('button', 'history-item');
    button.type = 'button';
    button.title = `${entry.game.name} · ${new Date(entry.at).toLocaleString('ru-RU')}`;
    const image = artwork(entry.game); image.className = 'history-image';
    button.append(element('span', 'history-index', String(i + 1).padStart(2, '0')), image, element('span', '', entry.game.name));
    button.addEventListener('click', () => { if (!busy) { previewId = entry.game.id; renderHero(); } });
    fragment.append(button);
  }
  if (!entries.length) fragment.append(element('p', 'history-empty', 'Здесь появятся твои находки. Первый ход за тобой.'));
  $('history-list').replaceChildren(fragment);
  $('clear-history').hidden = !state.history.length;
  $('clear-history').disabled = busy;
}
function setFilter(value) {
  filter = value;
  for (const tab of document.querySelectorAll('.filter-tab')) {
    const active = tab.dataset.filter === value;
    tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active));
  }
  renderGrid();
}

function renderCategoriesDialog() {
  const game = games.find(item => item.id === categoryGameId);
  $('categories-intro').textContent = game ? `Настрой категории для «${game.name}» или измени сами подборки.` : 'Создавай подборки для настроения, компании или свободного времени. Категории сохраняются в папке приложения.';
  $('game-category-editor').hidden = !game;
  $('category-game-name').textContent = game?.name ?? '';
  const options = document.createDocumentFragment();
  if (game) for (const category of profile.categories) {
    const label = element('label', 'category-option');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = (profile.assignments[game.id] ?? []).includes(category.id);
    input.disabled = !profileReady || profilePending;
    input.addEventListener('change', () => setGameCategory(game.id, category.id, input.checked));
    label.append(input, categoryBadge(category));
    options.append(label);
  }
  if (game && !profile.categories.length) options.append(element('p', 'category-empty', 'Сначала создай первую категорию ниже.'));
  $('game-category-options').replaceChildren(options);

  const list = document.createDocumentFragment();
  for (const category of profile.categories) {
    const row = element('form', 'category-manage-row');
    const marker = categoryBadge(category);
    marker.textContent = '';
    marker.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.value = category.name; input.maxLength = 32; input.required = true;
    input.setAttribute('aria-label', `Название категории ${category.name}`);
    input.disabled = !profileReady || profilePending;
    const saveButton = element('button', 'button button-quiet', 'Сохранить'); saveButton.type = 'submit';
    const deleteButton = element('button', 'icon-button'); deleteButton.type = 'button'; deleteButton.append(icon('close'));
    deleteButton.title = 'Удалить категорию'; deleteButton.setAttribute('aria-label', `Удалить категорию ${category.name}`);
    saveButton.disabled = deleteButton.disabled = !profileReady || profilePending;
    row.addEventListener('submit', event => { event.preventDefault(); renameCategory(category.id, input.value); });
    deleteButton.addEventListener('click', () => {
      if (confirm(`Удалить категорию «${category.name}»? Игры останутся в библиотеке.`)) deleteCategory(category.id);
    });
    row.append(marker, input, saveButton, deleteButton); list.append(row);
  }
  if (!profile.categories.length) list.append(element('p', 'category-empty', 'Категорий пока нет. Создай первую подборку.'));
  $('category-list').replaceChildren(list);
  $('category-name').disabled = !profileReady || profilePending || profile.categories.length >= 20;
  $('add-category-form').querySelector('button').disabled = !profileReady || profilePending || profile.categories.length >= 20;
  $('category-status').textContent = profilePending ? 'Сохраняем изменения…' : profileReady ? `Категорий: ${profile.categories.length} из 20. Изменения сохраняются автоматически.` : 'Категории недоступны. Нажми «Обновить список» в библиотеке.';
}
function openCategories(gameId = null) {
  categoryGameId = gameId;
  renderCategoriesDialog();
  if (!$('categories-dialog').open) $('categories-dialog').showModal();
}
async function mutateProfile(operation, successMessage) {
  if (!profileReady || profilePending || busy || scanning) return false;
  profilePending = true;
  renderCounts(); renderGrid(); renderCategoriesDialog();
  try {
    applyProfile(await operation(profile.revision));
    $('error-banner').hidden = true;
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    profileFailure(error, 'Не удалось подтвердить изменение категорий.');
    return false;
  } finally {
    profilePending = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid(); renderCategoriesDialog();
  }
}
const setGameCategory = (appId, categoryId, assigned) => mutateProfile(revision => profileClient.setCategory(revision, appId, categoryId, assigned), 'Категории игры сохранены');
const renameCategory = (id, name) => mutateProfile(revision => profileClient.renameCategory(revision, id, name), 'Категория переименована');
const deleteCategory = id => mutateProfile(revision => profileClient.deleteCategory(revision, id), 'Категория удалена');

async function draw() {
  if (busy || scanning || savingExclusion || !exclusionsReady || !profileReady || profilePending || !eligible().length) return;
  busy = true;
  renderCounts(); renderGrid(); renderHistory();
  try {
    // Another browser/port may have changed the shared profile or exclusions since our scan.
    const [, loaded] = await Promise.all([loadExclusions(), loadProfile()]);
    if (!loaded) throw new Error('Сохранённый профиль сейчас недоступен.');
    if (!eligible().length) { busy = false; renderCounts(); renderGrid(); renderHero(); renderHistory(); return; }
  } catch (error) {
    busy = false;
    $('error-banner').textContent = `Не удалось загрузить сохранённые данные перед выбором. ${error.message} Нажми «Обновить список».`;
    $('error-banner').hidden = false;
    renderCounts(); renderGrid(); renderHero(); renderHistory();
    return;
  }
  $('play-button').hidden = true; $('exclude-current').hidden = true;
  $('spotlight').classList.add('is-drawing');
  $('hero-kicker').textContent = 'ПЕРЕМЕШИВАЕМ ТВОЮ БИБЛИОТЕКУ';
  const result = drawGame(games, state, undefined, undefined, profile.assignments);
  // The animation is decorative. Only one final draw consumes the random bag.
  const pool = eligible();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    for (let i = 0; i < 8; i++) {
      $('hero-title').textContent = pool[i % pool.length].name;
      await new Promise(resolve => setTimeout(resolve, 70 + i * 13));
    }
  }
  try {
    profilePending = true;
    applyProfile(await profileClient.replaceDraw(profile.revision, drawSnapshot(result.state)));
    profileReady = true;
    previewId = result.game.id;
    $('error-banner').hidden = true;
  } catch (error) {
    profileFailure(error, 'Игра выбрана, но результат не удалось сохранить, поэтому розыгрыш отменён.');
    $('spotlight').classList.remove('is-drawing');
    busy = false; profilePending = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid();
    return;
  }
  profilePending = false;
  busy = false;
  $('spotlight').classList.remove('is-drawing');
  renderCounts(); renderHero(); renderHistory(); renderGrid();
  toast(result.newCycle ? `Новый круг. Сегодня - ${result.game.name}` : `Твой выбор: ${result.game.name}`);
  if (matchMedia('(max-width: 640px)').matches) {
    $('spotlight').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
  }
}

function renderLibraries() {
  const fragment = document.createDocumentFragment();
  const libraries = snapshot?.libraries ?? [];
  for (const library of libraries) {
    const row = element('div', 'library-path' + (library.available ? '' : ' unavailable'));
    const text = element('div');
    text.append(element('strong', '', library.path), element('small', '', library.available ? `Установленных игр: ${library.count}` : 'Диск или папка сейчас недоступны'));
    row.append(text);
    const custom = state.customPaths.find(value => value.toLowerCase().replace(/[\\/]+$/, '').replace(/[\\/]steamapps$/i, '') === library.path.toLowerCase().replace(/[\\/]+$/, ''));
    if (custom) {
      const remove = element('button', 'icon-button');
      remove.title = 'Убрать ручной путь (автоматически найденные библиотеки останутся)';
      remove.setAttribute('aria-label', `Убрать ручной путь ${custom}`);
      remove.append(icon('close'));
      remove.disabled = scanning;
      remove.addEventListener('click', () => { state.customPaths = state.customPaths.filter(value => value !== custom); save(); scan(); });
      row.append(remove);
    }
    fragment.append(row);
  }
  if (!libraries.length) fragment.append(element('p', 'dialog-intro', 'Автоматически найденных библиотек пока нет.'));
  for (const custom of state.customPaths) {
    if (libraries.some(library => library.path.toLowerCase() === custom.toLowerCase())) continue;
    if (!snapshot?.warnings.some(warning => warning.includes(custom))) continue;
    const row = element('div', 'library-path unavailable');
    const text = element('div');
    text.append(element('strong', '', custom), element('small', '', 'Папка не найдена'));
    const remove = element('button', 'icon-button'); remove.append(icon('close'));
    remove.setAttribute('aria-label', `Удалить недоступный ручной путь ${custom}`);
    remove.addEventListener('click', () => { state.customPaths = state.customPaths.filter(value => value !== custom); save(); scan(); });
    row.append(text, remove); fragment.append(row);
  }
  $('library-paths').replaceChildren(fragment);
  const notes = [];
  if (snapshot?.utilities) notes.push(`Служебные компоненты Steam скрыты: ${snapshot.utilities}.`);
  if (snapshot?.skipped) notes.push(`Пропущены незавершённые, пустые или недоступные установки: ${snapshot.skipped}.`);
  notes.push(...(snapshot?.warnings ?? []));
  if (snapshot?.scannedAt) notes.push(`Последняя проверка: ${new Date(snapshot.scannedAt).toLocaleTimeString('ru-RU')}.`);
  $('scan-notes').replaceChildren(...notes.map(text => element('p', '', text)));
}

async function scan({ addedPath } = {}) {
  if (scanning || busy || savingExclusion) return false;
  scanning = true;
  onlineSizes.clearQueue();
  onlineSizes.retryUnavailable();
  $('error-banner').hidden = true; $('path-error').hidden = true;
  $('refresh-button').classList.add('is-refreshing');
  $('path-input').disabled = true;
  $('add-path-form').querySelector('button').disabled = true;
  renderCounts();
  let success = false;
  try {
    await Promise.all([loadExclusions(), loadDisplaySettings(), loadProfile()]);
    const paths = addedPath ? [...state.customPaths, addedPath] : state.customPaths;
    const response = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths, includeUninstalled: state.includeUninstalled }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Не удалось прочитать библиотеки.');
    snapshot = data; games = data.games;
    if (addedPath) {
      const failed = data.warnings.some(warning => warning.startsWith('Не найдена папка steamapps:') && warning.includes(addedPath));
      if (failed) { $('path-error').textContent = 'В этой папке не найдена steamapps. Проверь путь и подключение диска.'; $('path-error').hidden = false; }
      else { state.customPaths = [...new Set(paths)]; save(); $('path-input').value = ''; toast('Библиотека добавлена'); }
    }
    success = true;
  } catch (error) {
    const message = error instanceof TypeError ? 'Нет связи с приложением. Запусти «Запустить.cmd» и обнови страницу.' : error.message;
    $('error-banner').textContent = message; $('error-banner').hidden = false;
    if ($('libraries-dialog').open) { $('path-error').textContent = message; $('path-error').hidden = false; }
  } finally {
    scanning = false;
    $('refresh-button').classList.remove('is-refreshing');
    $('path-input').disabled = false;
    $('add-path-form').querySelector('button').disabled = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries();
  }
  return success;
}

$('draw-button').addEventListener('click', draw);
$('refresh-button').addEventListener('click', async () => { if (await scan()) toast('Список игр обновлён'); });
$('include-uninstalled').addEventListener('change', async event => {
  if (scanning || busy || savingExclusion) return;
  const previous = state.includeUninstalled;
  state.includeUninstalled = event.target.checked;
  if (await scan()) save();
  else { state.includeUninstalled = previous; renderCounts(); renderHero(); renderHistory(); renderGrid(); }
});
$('search-input').addEventListener('input', renderGrid);
for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => setFilter(tab.dataset.filter));
$('category-filter').addEventListener('change', event => { categoryFilter = event.target.value; renderGrid(); });
$('draw-mode').addEventListener('change', event => updateDraw({ mode: event.target.value }, `Режим выбора: ${event.target.options[event.target.selectedIndex].textContent}`));
$('no-repeats').addEventListener('change', event => updateDraw({ noRepeats: event.target.checked }));
$('reset-cycle').addEventListener('click', () => updateDraw({ seen: [] }, 'Новый круг: все подходящие игры снова доступны'));
$('clear-history').addEventListener('click', () => updateDraw({ history: [] }, 'История очищена. Текущий круг сохранён.'));
$('exclude-current').addEventListener('click', async () => { if (previewId && await setExcluded(previewId, true)) toast('Исключение сохранено. Вернуть игру можно во вкладке «Исключены».'); });
$('play-button').addEventListener('click', () => toast('Подтверди открытие Steam, если браузер попросит.'));
$('categories-button').addEventListener('click', () => openCategories());
$('libraries-button').addEventListener('click', () => { renderLibraries(); $('libraries-dialog').showModal(); });
$('settings-button').addEventListener('click', () => { $('settings-dialog').showModal(); loadDisplaySettings(); });
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('retry-display').addEventListener('click', loadDisplaySettings);
for (const key of Object.keys(DISPLAY_DEFAULTS)) $(key).addEventListener('change', event => setDisplaySetting(key, event.target.checked));
$('settings-dialog').addEventListener('click', event => { if (event.target === $('settings-dialog')) { const rect = $('settings-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('settings-dialog').close(); } });
$('close-dialog').addEventListener('click', () => $('libraries-dialog').close());
$('libraries-dialog').addEventListener('click', event => { if (event.target === $('libraries-dialog')) { const rect = $('libraries-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('libraries-dialog').close(); } });
$('close-categories').addEventListener('click', () => $('categories-dialog').close());
$('categories-dialog').addEventListener('click', event => { if (event.target === $('categories-dialog')) { const rect = $('categories-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('categories-dialog').close(); } });
$('add-category-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('category-name');
  const name = input.value.trim();
  if (name && await mutateProfile(revision => profileClient.addCategory(revision, name), 'Категория добавлена')) input.value = '';
});
$('add-path-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('path-input').value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  if (!value || state.customPaths.includes(value)) return;
  if (state.customPaths.length >= 20) { $('path-error').textContent = 'Можно добавить не больше 20 ручных путей.'; $('path-error').hidden = false; return; }
  scan({ addedPath: value });
});
$('empty-action').addEventListener('click', () => { if (!scopedGames().length) $('libraries-dialog').showModal(); else { $('search-input').value = ''; categoryFilter = 'all'; renderCategorySelectors(); setFilter('all'); } });
document.addEventListener('keydown', event => {
  if ($('settings-dialog').open) return;
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || $('libraries-dialog').open || $('categories-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  event.preventDefault(); draw();
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || busy || scanning || savingExclusion) return;
  try {
    const next = cleanState(JSON.parse(event.newValue ?? '{}'));
    const scopeChanged = next.includeUninstalled !== state.includeUninstalled;
    const pathsChanged = JSON.stringify(next.customPaths) !== JSON.stringify(state.customPaths);
    state = cleanState({ ...state, includeUninstalled: next.includeUninstalled, customPaths: next.customPaths });
    if (scopeChanged || pathsChanged) scan();
    else { renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries(); }
  }
  catch { /* Ignore malformed updates from another browser tab. */ }
});
scan();
