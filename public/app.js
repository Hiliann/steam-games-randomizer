import { STORAGE_KEY, cleanState, gamesInScope, gameAction, eligibleGames, drawGame } from './randomizer.js';
import { createExclusionsClient } from './exclusions.js';
import { DISPLAY_DEFAULTS, createDisplayClient, formatSize, uninstalledSize, sizeDescription, sizeSourceUrl, heroBadges } from './display.js';
import { createOnlineSizesClient } from './online-sizes.js';

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
let displaySettings = { ...DISPLAY_DEFAULTS };
let displayReady = false;
let displayPending = false;
let displayMessage = 'Загружаем настройки…';
let previewId = state.current;
let toastTimer;
const scopedGames = () => gamesInScope(games, state);
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
function renderCounts() {
  const eligible = eligibleGames(games, state);
  const played = eligible.filter(game => state.seen.includes(game.id)).length;
  const scoped = scopedGames();
  $('installed-count').textContent = snapshot?.installedCount ?? games.filter(game => game.installed !== false).length;
  const count = snapshot?.libraries.filter(library => library.available && library.count).length ?? 0;
  $('library-count').textContent = `Библиотек: ${count}`;
  $('library-total').textContent = scoped.length;
  $('included-count').textContent = eligible.length;
  $('all-count').textContent = scoped.length;
  $('excluded-count').textContent = scoped.length - eligible.length;
  $('include-uninstalled').checked = state.includeUninstalled;
  $('include-uninstalled').disabled = busy || scanning || savingExclusion;
  $('library-kicker').textContent = state.includeUninstalled ? 'НА КОМПЬЮТЕРЕ И В ТВОЁМ STEAM' : 'ВСЁ УЖЕ НА ТВОЁМ КОМПЬЮТЕРЕ';
  renderScopeNote();
  $('no-repeats').checked = state.noRepeats;
  $('no-repeats').disabled = busy;
  $('draw-button').disabled = busy || scanning || savingExclusion || !exclusionsReady || !eligible.length;
  $('refresh-button').disabled = busy || scanning || savingExclusion;
  $('exclusions-status').textContent = savingExclusion ? 'Сохраняем исключения…' : exclusionsReady ? 'Исключения сохранены в приложении' : 'Исключения ещё не загружены';
  $('reset-cycle').disabled = busy || !state.seen.length;
  $('cycle-label').textContent = state.noRepeats ? `Выпало ${played} из ${eligible.length} в этом круге` : 'Повторы разрешены';
  $('cycle-progress').max = Math.max(1, eligible.length);
  $('cycle-progress').value = state.noRepeats ? played : 0;
  $('cycle-progress').hidden = !state.noRepeats;
  $('reset-cycle').hidden = !state.noRepeats;
  $('pool-note').textContent = !scoped.length ? 'Добавь библиотеку, чтобы начать.' : !eligible.length ? 'Все игры исключены. Верни хотя бы одну.' : state.noRepeats && played === eligible.length ? 'Следующий выбор начнёт новый круг.' : `В розыгрыше: ${eligible.length}. У каждой игры равный шанс.`;
  $('draw-label').textContent = busy ? 'Выбираем…' : state.current ? 'Предложить другую' : 'Выбрать игру';
  $('online-size-note').hidden = !state.includeUninstalled || !displaySettings.showUninstalledSize;
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
    $('hero-description').textContent = scoped.length ? 'Нажми «Выбрать игру» — мы найдём, во что погрузиться сегодня.' : 'Если Steam установлен в необычной папке, укажи её в разделе «Библиотеки».';
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
  const visible = scoped.filter(game => (filter === 'all' || (filter === 'excluded' ? excluded.has(game.id) : !excluded.has(game.id))) && game.name.toLocaleLowerCase('ru').includes(term));
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
    card.append(art, title, meta, toggle);
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
  $('search-note').hidden = !term;
  $('visible-count').textContent = `Показано ${visible.length} из ${scoped.length} игр`;
  if (!visible.length) {
    $('empty-title').textContent = !scoped.length ? 'Игры пока не найдены' : term ? 'Ничего не нашлось' : filter === 'excluded' ? 'Все игры в деле' : 'Все игры исключены';
    $('empty-description').textContent = !scoped.length ? state.includeUninstalled ? 'Открой библиотеку в Steam онлайн и обнови список. При необходимости укажи папку клиента Steam.' : 'Укажи папку Steam или SteamLibrary. Сейчас учитываем только установки на диске.' : term ? 'Попробуй другое название или переключись на вкладку «Все».' : filter === 'excluded' ? 'Исключённые игры появятся здесь. Сейчас каждая может выпасть.' : 'Открой вкладку «Исключены» и верни игры в розыгрыш.';
    $('empty-action').textContent = !scoped.length ? 'Указать папку' : term ? 'Сбросить поиск' : 'Показать все игры';
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

async function draw() {
  if (busy || scanning || savingExclusion || !exclusionsReady || !eligibleGames(games, state).length) return;
  busy = true;
  renderCounts(); renderGrid(); renderHistory();
  try {
    // Another browser/port may have changed the shared exclusions since our scan.
    await loadExclusions();
    if (!eligibleGames(games, state).length) { busy = false; renderCounts(); renderGrid(); renderHero(); renderHistory(); return; }
  } catch (error) {
    busy = false;
    $('error-banner').textContent = 'Не удалось загрузить сохранённые исключения. Запусти приложение и нажми «Обновить список».';
    $('error-banner').hidden = false;
    renderCounts(); renderGrid(); renderHero(); renderHistory();
    return;
  }
  $('play-button').hidden = true; $('exclude-current').hidden = true;
  $('spotlight').classList.add('is-drawing');
  $('hero-kicker').textContent = 'ПЕРЕМЕШИВАЕМ ТВОЮ БИБЛИОТЕКУ';
  const result = drawGame(games, state);
  // The animation is decorative. Only one final draw consumes the random bag.
  const pool = eligibleGames(games, state);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    for (let i = 0; i < 8; i++) {
      $('hero-title').textContent = pool[i % pool.length].name;
      await new Promise(resolve => setTimeout(resolve, 70 + i * 13));
    }
  }
  state = result.state; previewId = result.game.id; save();
  busy = false;
  $('spotlight').classList.remove('is-drawing');
  renderCounts(); renderHero(); renderHistory(); renderGrid();
  toast(result.newCycle ? `Новый круг. Сегодня — ${result.game.name}` : `Твой выбор: ${result.game.name}`);
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
    await Promise.all([loadExclusions(), loadDisplaySettings()]);
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
$('no-repeats').addEventListener('change', event => { state.noRepeats = event.target.checked; save(); renderCounts(); });
$('reset-cycle').addEventListener('click', () => { if (!busy) { state.seen = []; save(); renderCounts(); toast('Новый круг: все участвующие игры снова доступны'); } });
$('clear-history').addEventListener('click', () => { if (!busy) { state.history = []; save(); renderHistory(); toast('История очищена. Текущий круг сохранён.'); } });
$('exclude-current').addEventListener('click', async () => { if (previewId && await setExcluded(previewId, true)) toast('Исключение сохранено. Вернуть игру можно во вкладке «Исключены».'); });
$('play-button').addEventListener('click', () => toast('Подтверди открытие Steam, если браузер попросит.'));
$('libraries-button').addEventListener('click', () => { renderLibraries(); $('libraries-dialog').showModal(); });
$('settings-button').addEventListener('click', () => { $('settings-dialog').showModal(); loadDisplaySettings(); });
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('retry-display').addEventListener('click', loadDisplaySettings);
for (const key of Object.keys(DISPLAY_DEFAULTS)) $(key).addEventListener('change', event => setDisplaySetting(key, event.target.checked));
$('settings-dialog').addEventListener('click', event => { if (event.target === $('settings-dialog')) { const rect = $('settings-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('settings-dialog').close(); } });
$('close-dialog').addEventListener('click', () => $('libraries-dialog').close());
$('libraries-dialog').addEventListener('click', event => { if (event.target === $('libraries-dialog')) { const rect = $('libraries-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('libraries-dialog').close(); } });
$('add-path-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('path-input').value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  if (!value || state.customPaths.includes(value)) return;
  if (state.customPaths.length >= 20) { $('path-error').textContent = 'Можно добавить не больше 20 ручных путей.'; $('path-error').hidden = false; return; }
  scan({ addedPath: value });
});
$('empty-action').addEventListener('click', () => { if (!scopedGames().length) $('libraries-dialog').showModal(); else { $('search-input').value = ''; setFilter('all'); } });
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || $('libraries-dialog').open || $('settings-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  event.preventDefault(); draw();
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || busy || scanning || savingExclusion) return;
  try {
    const previous = state.includeUninstalled;
    const next = cleanState(JSON.parse(event.newValue ?? '{}'));
    const exclusionsChanged = JSON.stringify(next.excluded) !== JSON.stringify(state.excluded);
    state = { ...next, excluded: state.excluded }; previewId = state.current;
    if (previous !== state.includeUninstalled || exclusionsChanged) scan();
    else { renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries(); }
  }
  catch { /* Ignore malformed updates from another browser tab. */ }
});
scan();
