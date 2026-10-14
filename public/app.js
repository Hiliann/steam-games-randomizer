import { STORAGE_KEY, cleanState, eligibleGames, drawGame } from './randomizer.js';

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
let previewId = state.current;
let toastTimer;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { $('storage-banner').hidden = false; }
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
function formatSize(bytes) {
  if (!bytes) return 'На диске';
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} МБ`;
  return `${(bytes / 1024 ** 3).toLocaleString('ru', { maximumFractionDigits: 1 })} ГБ`;
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
  $('installed-count').textContent = games.length;
  const count = snapshot?.libraries.filter(library => library.available && library.count).length ?? 0;
  $('library-count').textContent = `Библиотек: ${count}`;
  $('library-total').textContent = games.length;
  $('included-count').textContent = eligible.length;
  $('all-count').textContent = games.length;
  $('excluded-count').textContent = games.length - eligible.length;
  $('no-repeats').checked = state.noRepeats;
  $('no-repeats').disabled = busy;
  $('draw-button').disabled = busy || scanning || !eligible.length;
  $('refresh-button').disabled = busy || scanning;
  $('reset-cycle').disabled = busy || !state.seen.length;
  $('cycle-label').textContent = state.noRepeats ? `Выпало ${played} из ${eligible.length} в этом круге` : 'Повторы разрешены';
  $('cycle-progress').max = Math.max(1, eligible.length);
  $('cycle-progress').value = state.noRepeats ? played : 0;
  $('cycle-progress').hidden = !state.noRepeats;
  $('reset-cycle').hidden = !state.noRepeats;
  $('pool-note').textContent = !games.length ? 'Добавь библиотеку, чтобы начать.' : !eligible.length ? 'Все игры исключены. Верни хотя бы одну.' : state.noRepeats && played === eligible.length ? 'Следующий выбор начнёт новый круг.' : `В розыгрыше: ${eligible.length}. У каждой игры равный шанс.`;
  $('draw-label').textContent = busy ? 'Выбираем…' : state.current ? 'Предложить другую' : 'Выбрать игру';
}
function renderHero() {
  const selected = games.find(game => game.id === previewId);
  const game = selected ?? games.find(item => !state.excluded.includes(item.id)) ?? games[0];
  const image = $('hero-image');
  if (game) {
    const url = `/art/${game.id}/hero?v=${ARTWORK_VERSION}`;
    if (image.getAttribute('src') !== url) { image.hidden = true; image.src = url; }
    $('hero-disk').textContent = `${game.disk} · ${formatSize(game.size)}`;
    $('hero-disk').hidden = false;
  } else { image.removeAttribute('src'); image.hidden = true; $('hero-disk').hidden = true; }
  $('play-button').hidden = !selected;
  $('exclude-current').hidden = !selected || state.excluded.includes(selected.id);
  if (selected) {
    $('spotlight-tag').textContent = 'СЕГОДНЯ В ИГРЕ';
    $('hero-kicker').textContent = state.excluded.includes(selected.id) ? 'ИСКЛЮЧЕНА ИЗ БУДУЩИХ РОЗЫГРЫШЕЙ' : 'СЛУЧАЙ ВЫБРАЛ. ОСТАЛОСЬ НАЖАТЬ PLAY.';
    $('hero-title').textContent = selected.name;
    $('hero-description').textContent = selected.updateRequired ? 'Игра установлена. Перед запуском Steam может предложить обновление.' : lastPlayedLabel(selected);
    $('play-button').href = `steam://run/${selected.id}`;
    $('cover-caption').textContent = 'Обложка из твоей библиотеки Steam';
  } else {
    $('spotlight-tag').textContent = 'ТВОЯ СЛЕДУЮЩАЯ ИГРА';
    $('hero-kicker').textContent = games.length ? 'БИБЛИОТЕКА ПОЛНА ВОЗМОЖНОСТЕЙ' : 'НАЧНЁМ С ТВОЕЙ БИБЛИОТЕКИ';
    $('hero-title').textContent = games.length ? 'Вечер свободен. Игра найдётся.' : 'Твоя следующая игра уже где-то рядом.';
    $('hero-description').textContent = games.length ? 'Нажми «Выбрать игру» — мы найдём, во что погрузиться сегодня.' : 'Если Steam установлен в необычной папке, укажи её в разделе «Библиотеки».';
    $('play-button').removeAttribute('href');
    $('cover-caption').textContent = game ? `На обложке: ${game.name}` : '';
  }
}
$('hero-image').addEventListener('load', () => { $('hero-image').hidden = false; });
$('hero-image').addEventListener('error', () => { $('hero-image').hidden = true; $('cover-caption').textContent = ''; });

function setExcluded(id, excluded) {
  if (busy) return;
  const ids = new Set(state.excluded);
  if (excluded) ids.add(id); else ids.delete(id);
  state.excluded = [...ids];
  save();
  renderCounts(); renderGrid(); renderHero();
}
function renderGrid() {
  const term = $('search-input').value.trim().toLocaleLowerCase('ru');
  const excluded = new Set(state.excluded);
  const visible = games.filter(game => (filter === 'all' || (filter === 'excluded' ? excluded.has(game.id) : !excluded.has(game.id))) && game.name.toLocaleLowerCase('ru').includes(term));
  const fragment = document.createDocumentFragment();
  for (const game of visible) {
    const isExcluded = excluded.has(game.id);
    const card = element('article', 'game-card' + (isExcluded ? ' excluded' : ''));
    const art = element('div', 'game-art');
    const fallback = element('div', 'game-placeholder');
    fallback.append(icon('game'), element('span', '', game.name));
    fallback.setAttribute('aria-hidden', 'true');
    art.append(fallback, artwork(game), element('span', 'card-disk', game.disk));
    const title = element('h3', '', game.name); title.title = game.name;
    const meta = element('div', 'game-meta');
    meta.append(element('span', '', formatSize(game.size)), element('span', '', game.updateRequired ? 'Обновление' : 'Установлена'));
    const toggle = element('label', 'game-toggle');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = !isExcluded; checkbox.disabled = busy;
    checkbox.setAttribute('aria-label', `Участвует в розыгрыше: ${game.name}`);
    checkbox.addEventListener('change', () => {
      const nextId = visible[visible.indexOf(game) + 1]?.id ?? visible[visible.indexOf(game) - 1]?.id;
      setExcluded(game.id, !checkbox.checked);
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
  $('game-grid').setAttribute('aria-busy', String(scanning));
  $('empty-state').hidden = !!visible.length;
  $('search-note').hidden = !term;
  $('visible-count').textContent = `Показано ${visible.length} из ${games.length} игр`;
  if (!visible.length) {
    $('empty-title').textContent = !games.length ? 'Игры пока не найдены' : term ? 'Ничего не нашлось' : filter === 'excluded' ? 'Все игры в деле' : 'Все игры исключены';
    $('empty-description').textContent = !games.length ? 'Укажи папку Steam или SteamLibrary. Учитываем только установки, которые есть на диске.' : term ? 'Попробуй другое название или переключись на вкладку «Все».' : filter === 'excluded' ? 'Исключённые игры появятся здесь. Сейчас каждая может выпасть.' : 'Открой вкладку «Исключены» и верни игры в розыгрыш.';
    $('empty-action').textContent = !games.length ? 'Указать папку' : term ? 'Сбросить поиск' : 'Показать все игры';
  }
}
function renderHistory() {
  const entries = state.history.map(entry => ({ ...entry, game: games.find(game => game.id === entry.id) })).filter(entry => entry.game).slice(0, 7);
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
  if (busy || scanning || !eligibleGames(games, state).length) return;
  busy = true;
  renderCounts(); renderGrid(); renderHistory();
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
  if (scanning || busy) return false;
  scanning = true;
  $('error-banner').hidden = true; $('path-error').hidden = true;
  $('refresh-button').classList.add('is-refreshing');
  $('path-input').disabled = true;
  $('add-path-form').querySelector('button').disabled = true;
  renderCounts();
  let success = false;
  try {
    const paths = addedPath ? [...state.customPaths, addedPath] : state.customPaths;
    const response = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths }) });
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
$('refresh-button').addEventListener('click', async () => { if (await scan()) toast('Список установленных игр обновлён'); });
$('search-input').addEventListener('input', renderGrid);
for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => setFilter(tab.dataset.filter));
$('no-repeats').addEventListener('change', event => { state.noRepeats = event.target.checked; save(); renderCounts(); });
$('reset-cycle').addEventListener('click', () => { if (!busy) { state.seen = []; save(); renderCounts(); toast('Новый круг: все участвующие игры снова доступны'); } });
$('clear-history').addEventListener('click', () => { if (!busy) { state.history = []; save(); renderHistory(); toast('История очищена. Текущий круг сохранён.'); } });
$('exclude-current').addEventListener('click', () => { if (previewId && !busy) { setExcluded(previewId, true); toast('Игра больше не участвует. Вернуть её можно во вкладке «Исключены».'); } });
$('play-button').addEventListener('click', () => toast('Подтверди открытие Steam, если браузер попросит.'));
$('libraries-button').addEventListener('click', () => { renderLibraries(); $('libraries-dialog').showModal(); });
$('close-dialog').addEventListener('click', () => $('libraries-dialog').close());
$('libraries-dialog').addEventListener('click', event => { if (event.target === $('libraries-dialog')) { const rect = $('libraries-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('libraries-dialog').close(); } });
$('add-path-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('path-input').value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  if (!value || state.customPaths.includes(value)) return;
  if (state.customPaths.length >= 20) { $('path-error').textContent = 'Можно добавить не больше 20 ручных путей.'; $('path-error').hidden = false; return; }
  scan({ addedPath: value });
});
$('empty-action').addEventListener('click', () => { if (!games.length) $('libraries-dialog').showModal(); else { $('search-input').value = ''; setFilter('all'); } });
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || $('libraries-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  event.preventDefault(); draw();
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || busy) return;
  try { state = cleanState(JSON.parse(event.newValue ?? '{}')); previewId = state.current; renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries(); }
  catch { /* Ignore malformed updates from another browser tab. */ }
});
scan();
