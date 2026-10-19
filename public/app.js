import { createSettingsController } from './settings-controller.js';
import { renderLibraryCards } from './library-view.js';
import { createFilterPresetsView } from './filter-presets.js';
import { STORE_FEATURES, createStoreDetailsClient, featureLabel, genreLabel, storeProgressText } from './store-details.js';
import { STORAGE_KEY, cleanState, cleanDrawState, gamesInScope, gameAction, eligibleGames, drawGame, animationGames, hasPlayed } from './randomizer.js';
import { createExclusionsClient } from './exclusions.js';
import { DISPLAY_DEFAULTS, createDisplayClient, formatSize, uninstalledSize, sizeDescription, sizeSourceUrl, heroBadges } from './display.js';
import { createOnlineSizesClient } from './online-sizes.js';
import { createProfileClient } from './profile.js';
import { createSystemClient } from './system.js';
import { createUpdateController } from './update-controller.js';
import { APP_DEFAULTS, createAppSettingsClient } from './app-settings.js';
import { createRandomAccent } from './ui-settings.js';
import { createAppearanceController } from './appearance-controller.js';
import { createBackupClient } from './backup.js';
import { createDiagnosticsController } from './diagnostics-controller.js';
import { getLocale, startLocalization, tr } from './i18n.js';
import { connectBrowserSession } from './browser-session.js';
import { createDescriptionsClient } from './descriptions.js';
import { createWorkspace, cleanLibraryView, filterLibraryGames, sortLibraryGames, LIBRARY_VIEW_KEY } from './workspace.js';
import { createToast } from './toast.js';
import { participationDetails, createDescriptionDisclosure } from './game-details.js';
import { createDecisionDialog } from './decision.js';
import { createScrollActivity } from './scroll-activity.js';
import { createStartupScreen } from './startup.js';
import { createHeroArtwork, playDrawFrames } from './draw-animation.js';
import { collectionView, collectionChanges, collectionFocusAfterToggle, collectionCounts } from './collections.js';

const $ = id => document.getElementById(id);
const startup = createStartupScreen({ node: $('startup-screen'), status: $('startup-status'), content: document.querySelector('.app-shell'), skip: $('skip-startup') });
startLocalization();
if (window.chrome?.webview) document.documentElement.dataset.desktop = 'true';
// Bypass covers cached by older versions that did not resolve nested Steam assets.
const ARTWORK_VERSION = '3';
const heroArtwork = createHeroArtwork({ image: $('hero-image'), version: ARTWORK_VERSION });
let animationGame = null;
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
const systemClient = createSystemClient();
const appSettingsClient = createAppSettingsClient();
const backupClient = createBackupClient();

const displayModel=createSettingsController({client:displayClient,defaults:DISPLAY_DEFAULTS,loading:'Загружаем настройки…',
  loaded:()=> 'Настройки сохраняются автоматически в папке приложения.',saved:()=> 'Настройки сохранены.',
  failure:(error,operation)=>operation==='load'?(error instanceof TypeError?'Нет связи с приложением. Запусти его и повтори загрузку настроек.':error.message):'Не удалось подтвердить сохранение. '+(error instanceof TypeError?'Проверь, что приложение запущено.':error.message)+' Нажми «Повторить загрузку».',
  onChange:()=>renderDisplaySettings(),onSettled(){renderHero();renderGrid();},
});
const windowsModel=createSettingsController({client:{load:()=>systemClient.loadWindows(),set:(key,value)=>systemClient.setWindows(key,value)},
  defaults:{supported:true,desktopShortcut:false,startup:false},loading:'Проверяем настройки Windows…',
  loaded:value=>value.supported?'Изменения применяются сразу к этой копии программы.':'Эти функции доступны только в Windows.',
  saved:(key,value)=>key==='desktopShortcut'?(value?'Ярлык Play Next создан на рабочем столе.':'Ярлык этой копии удалён с рабочего стола.'):(value?'Play Next будет запускаться вместе с Windows.':'Запуск вместе с Windows выключен.'),
  failure:(error,operation)=>error instanceof TypeError?(operation==='load'?'Нет связи с приложением. Запусти его и повтори проверку.':'Нет связи с приложением. Повтори проверку.'):error.message,
  onChange:()=>renderWindowsSettings(),
});
const appModel=createSettingsController({client:appSettingsClient,defaults:APP_DEFAULTS,loading:'Загружаем настройки обновлений…',
  optimistic:true,invalidateOnSaveError:false,
  loaded:value=>value.automaticUpdates?'Автообновление при запуске включено.':'Автообновление при запуске выключено.',
  saved:(key,value)=>key==='automaticUpdates'?(value?'Автообновление при запуске включено.':'Автообновление при запуске выключено.'):(value?'Окно о новой версии включено.':'Окно о новой версии выключено.'),
  failure:(error,operation)=>operation==='load'?(error instanceof TypeError?'Нет связи с приложением. Повтори загрузку.':error.message):'Не удалось сохранить настройку. '+(error instanceof TypeError?'Проверь, что приложение запущено, и попробуй ещё раз.':error.message),
  onChange:()=>renderAppSettings(),
});

const appearance=createAppearanceController({$,onLocalized:rerenderLocalizedContent,toast});
const renderUiSettings=()=>appearance.render();
const loadUiSettings=()=>appearance.load();
const setUiSetting=(key,value)=>appearance.set(key,value);
const previewCustomAccent=(value,message)=>appearance.preview(value,message);
const cancelAccentPreview=()=>appearance.cancel();
const saveCustomAccent=()=>appearance.save();
let backupPending = false;
let backupMessage = 'Данные остаются только на этом компьютере, пока ты сам не сохранишь файл.';
let scanFailed = false;
let updateApplying = false;
let profile = { initialized: false, revision: 0, categories: [], assignments: {}, draw: cleanDrawState(state), presets: [] };
let profileReady = false;
let profilePending = false;
let categoryFilter = 'all', genreFilter = 'all', featureFilter = 'all';
let categorySelectedId = null;
let categoryDraft = new Set();
let categoryDraftOriginal = new Set();
let categoryDraftRevision = -1;
let libraryCategoryMenuId = null;
let categoryGameFilter = 'all';
let categoryFocusGameId = null;
let launching = false;
let previewId = state.current;
const notifications = createToast({ node: $('toast'), onError: error => toast(error.message) });
const descriptionDisclosure = createDescriptionDisclosure({ description: $('hero-description'), space: $('hero-description-space'), button: $('toggle-description'), dialog: $('description-dialog'), fullDescription: $('full-game-description'), title: $('hero-title'), dialogTitle: $('description-dialog-title'), closeButton: $('close-description') });
const scrollActivity = createScrollActivity();
window.addEventListener('pagehide', () => scrollActivity.dispose(), { once: true });
const decisions = createDecisionDialog({ dialog: $('decision-dialog'), title: $('decision-title'), message: $('decision-message'), status: $('decision-status'), save: $('decision-save'), discard: $('decision-discard'), cancel: $('decision-cancel') });
const diagnostics=createDiagnosticsController({$,canStart:()=>!backupPending&&!updateApplying&&!$('decision-dialog').open});
window.addEventListener('pagehide',()=>diagnostics.dispose(),{once:true});
const updates=createUpdateController({client:systemClient,$,version:$('app-version').textContent.trim(),
  getSettings:()=>({ready:appModel.ready,value:appModel.value}),
  canApply:()=>!busy&&!scanning&&!launching&&!profilePending&&!savingExclusion&&!backupPending&&!diagnostics.busy&&!appearance.pending&&!appModel.pending&&!windowsModel.pending&&!displayModel.pending&&!categoryDraftDirty()&&!appearance.previewing&&!$('decision-dialog').open,
  bridge:window.chrome?.webview,toast,
  onApplying(value){updateApplying=value;document.querySelector('.app-shell').inert=value;renderCounts();renderHero();},
  onStatus:()=>renderAppSettings(),
});
const renderUpdateStatus=()=>updates.render();
const checkForUpdate=options=>updates.check(options);
const installUpdate=()=>updates.install();
window.addEventListener('pagehide',()=>updates.dispose(),{once:true});
if (typeof ResizeObserver === 'function') {
  const descriptionObserver = new ResizeObserver(() => descriptionDisclosure.refresh());
  descriptionObserver.observe($('hero-description-space')); descriptionObserver.observe($('spotlight'));
}
const compactChooser = window.matchMedia('(max-width: 850px)');
const adaptDrawOptions = () => { $('draw-options').open = !compactChooser.matches; };
compactChooser.addEventListener('change', adaptDrawOptions);
adaptDrawOptions();
let workspace;
let libraryView = cleanLibraryView();
try { libraryView = cleanLibraryView(JSON.parse(localStorage.getItem(LIBRARY_VIEW_KEY) ?? '{}')); }
catch { /* A view preference must never prevent loading the saved game data. */ }
const scopedGames = () => gamesInScope(games, state);
const storeClient = createStoreDetailsClient();
let storeDetails = { revision: 0, progress: null, entries: {}, names: {} }, storeTimer = null, storeLoading = false;
function applyStoreDetails() { for (const game of games) game.store = storeDetails.entries[game.id] ?? null; }
// Genres load in the background on the local service; poll only while it works.
async function loadStoreDetails({ reset = false } = {}) {
  clearTimeout(storeTimer); storeTimer = null;
  if (storeLoading) return;
  storeLoading = true;
  try {
    const result = await storeClient.load(reset ? 0 : storeDetails.revision);
    const changed = reset || Object.keys(result.entries).length > 0;
    storeDetails = { revision: result.revision, progress: result.progress, entries: reset ? result.entries : { ...storeDetails.entries, ...result.entries }, names: { ...storeDetails.names, ...result.names } };
    if (changed) { applyStoreDetails(); renderCounts(); if (workspace?.current === 'library') renderGrid(); }
    if (['loading', 'blocked'].includes(result.progress.state)) storeTimer = setTimeout(loadStoreDetails, result.progress.state === 'blocked' ? 60000 : 4000);
  } catch {
    // Genres are optional. The next library refresh asks again.
  } finally {
    storeLoading = false;
    renderStoreStatus();
  }
}
function renderStoreStatus() {
  const text = storeProgressText(storeDetails.progress);
  $('store-details-status').textContent = text;
  $('store-details-status').hidden = !text;
  $('store-genres-note').textContent = tr('Этот переключатель также управляет фоновой загрузкой жанров и режимов игры (одиночная, мультиплеер, кооператив) из Steam Store для всей библиотеки. Уже загруженные сведения хранятся в data/store-details.json без срока годности, повторно запрашиваются только недостающие игры.', 'This switch also controls background loading of genres and play modes (single-player, multiplayer, co-op) from Steam Store for the whole library. Loaded details are kept in data/store-details.json without expiry; only missing games are requested again.');
}
function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.options !== key) {
    select.replaceChildren(...options.map(([optionValue, label]) => { const option = element('option', '', label); option.value = optionValue; return option; }));
    select.dataset.options = key;
  }
  select.value = value;
}
function libraryGenres(scoped) {
  const counts = new Map();
  for (const game of scoped) for (const id of game.store?.genres ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const collator = new Intl.Collator(getLocale(), { sensitivity: 'base' });
  return [...counts].sort(([a], [b]) => collator.compare(genreLabel(a, storeDetails.names), genreLabel(b, storeDetails.names)));
}
function renderStoreFilters(scoped) {
  const known = scoped.filter(game => game.store).length;
  const show = known > 0 || genreFilter !== 'all' || featureFilter !== 'all';
  $('genre-filter-label').hidden = !show; $('feature-filter-label').hidden = !show;
  if (!show) return;
  $('genre-filter-caption').textContent = tr('Жанр', 'Genre');
  $('feature-filter-caption').textContent = tr('Режим игры', 'Play mode');
  const genres = libraryGenres(scoped).map(([id, count]) => [id, `${genreLabel(id, storeDetails.names)} (${count})`]);
  if (!['all', 'unknown'].includes(genreFilter) && !genres.some(([id]) => id === genreFilter)) genres.push([genreFilter, genreLabel(genreFilter, storeDetails.names)]);
  // Offer the unknown state only while some games have no confirmed Store data.
  const unknownGenre = known < scoped.length || genreFilter === 'unknown' ? [['unknown', tr('Жанр не загружен', 'Genre not loaded')]] : [];
  const unknownFeature = scoped.some(game => !game.store?.features) || featureFilter === 'unknown' ? [['unknown', featureLabel('unknown')]] : [];
  fillSelect($('genre-filter'), [['all', tr('Любой жанр', 'Any genre')], ...genres, ...unknownGenre], genreFilter);
  fillSelect($('feature-filter'), [['all', tr('Любой режим', 'Any mode')], ...STORE_FEATURES.map(feature => [feature, featureLabel(feature)]), ...unknownFeature], featureFilter);
}const filterPresets = createFilterPresetsView({ container: $('filter-presets'), element, icon,
  getPresets: () => profile.presets, getCategories: () => profile.categories, getGenreNames: () => storeDetails.names, getFilters: currentLibraryFilters,
  isBusy: () => !profileReady || profilePending || busy || scanning, onApply: applyFilterPreset,
  onSave: (name, filters) => mutateProfile(revision => profileClient.addPreset(revision, name, filters), tr('Набор фильтров сохранён', 'Filter preset saved')),
  onDelete: preset => mutateProfile(revision => profileClient.deletePreset(revision, preset.id), tr('Набор фильтров удалён', 'Filter preset deleted')),
});
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
const descriptions = createDescriptionsClient({ onUpdate(id, language, result) {
  const game = games.find(game => game.id === id);
  if (!game) return;
  game.storeDescriptions ??= {};
  game.storeDescriptions[language] = result;
  if (heroGameId === id && appearance.value.language === language && (animationGame?.id === id || previewId === id)) renderHeroDescription(game);
} });
const sizeObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    sizeObserver.unobserve(entry.target);
    requestOnlineSize(games.find(game => game.id === entry.target.dataset.sizeId));
  }
}, { rootMargin: '180px' }) : null;

function requestOnlineSize(game, priority = false) {
  if (!game || game.installed !== false || !displayModel.ready || !displayModel.value.showUninstalledSize || !state.includeUninstalled || scanning) return;
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
  const enabled = game.installed === false && displayModel.value.showUninstalledSize;
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
  const badges = heroBadges(game, displayModel.value);
  $('hero-disk').textContent = badges.status;
  $('hero-disk').hidden = !badges.status;
  $('hero-size').textContent = badges.size;
  $('hero-size').title = badges.description;
  $('hero-size').hidden = !badges.size;
  const source = game?.installed === false && displayModel.value.showUninstalledSize ? sizeSourceUrl(game) : '';
  $('hero-size-source').hidden = !source;
  if (source) $('hero-size-source').href = source; else $('hero-size-source').removeAttribute('href');
}

function requestGameDescription(game) {
  if (!game || scanning) return;
  descriptions.request(game.id, appearance.value.language, true);
  const result = descriptions.get(game.id, appearance.value.language);
  game.storeDescriptions ??= {};
  if (result) game.storeDescriptions[appearance.value.language] = result;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { $('storage-banner').hidden = false; }
}
function drawSnapshot(value = state) {
  return cleanDrawState({ mode: value.mode, noRepeats: value.noRepeats, seen: value.seen, history: value.history, current: value.current });
}
function applyProfile(next, { resetPreview = true } = {}) {
  profile = next;
  const browserOnly = { excluded: state.excluded, includeUninstalled: state.includeUninstalled, customPaths: state.customPaths };
  state = cleanState({ ...state, ...next.draw, ...browserOnly });
  if (resetPreview) previewId = state.current;
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
    if (!$('categories-dialog').hidden) renderCategoriesDialog();
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
function toast(message, action) { notifications.show(message, action); }
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
function rerenderLocalizedContent() {
  renderDisplaySettings(); renderWindowsSettings(); renderAppSettings(); renderUpdateStatus(); renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries(); renderStoreStatus();
  if (!$('categories-dialog').hidden) renderCategoriesDialog();
}
function renderBackup() {
  $('export-backup').disabled = backupPending;
  $('import-backup').disabled = backupPending;
  $('backup-status').textContent = backupMessage;
}
async function exportBackup() {
  if (backupPending) return;
  backupPending = true;
  backupMessage = 'Собираем резервную копию…';
  renderBackup();
  try {
    const backup = await backupClient.exportBackup({ includeUninstalled: state.includeUninstalled, customPaths: state.customPaths });
    const blob = new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Play-Next-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    backupMessage = 'Резервная копия скачана. Храни её как обычный личный файл.';
  } catch (error) {
    backupMessage = error instanceof TypeError ? 'Нет связи с приложением. Запусти его и повтори.' : error.message;
  } finally {
    backupPending = false;
    renderBackup();
  }
}
async function restoreBackup(file) {
  if (backupPending || !file) return;
  backupPending = true;
  backupMessage = 'Проверяем резервную копию. Данные пока не изменяются…';
  renderBackup();
  try {
    const prepared = await backupClient.prepareBackup(file);
    const summary = prepared.summary;
    const date = new Date(summary.createdAt).toLocaleString(getLocale());
    let restoreAttempted = false;
    const unlock = () => { backupPending = false; backupMessage = restoreAttempted
      ? 'Восстановление не подтверждено. Проверь данные перед повторной попыткой.'
      : 'Восстановление отменено. Данные не изменены.'; renderBackup(); };
    const opened = decisions.request({ title: tr('Восстановить резервную копию?', 'Restore this backup?'),
      message: tr(`Создана: ${date} · Play Next ${summary.appVersion}\nКатегорий: ${summary.categories} · игр в категориях: ${summary.assignedGames}\nЗаписей истории: ${summary.history} · исключений: ${summary.exclusions}\nДополнительных папок Steam: ${summary.customPaths}\n\nФайл проверен. Текущие категории, история, исключения и настройки будут заменены. Если хочешь сохранить нынешние данные, сначала отмени и скачай их копию.`,
        `Created: ${date} · Play Next ${summary.appVersion}\nCategories: ${summary.categories} · games in categories: ${summary.assignedGames}\nHistory entries: ${summary.history} · exclusions: ${summary.exclusions}\nCustom Steam folders: ${summary.customPaths}\n\nThe file is valid. Your current categories, history, exclusions and settings will be replaced. To keep your current data, cancel and download a backup first.`),
      discardLabel: tr('Заменить данные', 'Replace data'), cancelLabel: tr('Отмена', 'Cancel'), danger: true,
      pendingMessage: tr('Восстанавливаем данные…', 'Restoring data…'), onCancel: unlock,
      onDiscard: async () => {
        restoreAttempted = true;
        backupMessage = 'Восстанавливаем данные…'; renderBackup();
        try {
          const result = await backupClient.restorePrepared(prepared);
          state = cleanState({ ...state, ...result.browser }); save();
          backupPending = false;
          backupMessage = 'Данные восстановлены. Перезапускаем страницу…'; renderBackup();
        } catch (error) { throw error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name)
          ? new Error(tr('Связь прервалась. Не удалось подтвердить восстановление. Проверь данные перед повторной попыткой.', 'Connection interrupted. Restore could not be confirmed. Check your data before trying again.')) : error; }
      }, proceed: () => location.reload() });
    if (!opened) unlock();
  } catch (error) {
    backupMessage = error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name) ? 'Нет связи с приложением. Данные не изменены.' : error.message;
    backupPending = false;
    renderBackup();
  }
}
function renderDisplaySettings() {
  for (const key of Object.keys(DISPLAY_DEFAULTS)) {
    $(key).checked = displayModel.value[key];
    $(key).disabled = !displayModel.ready || displayModel.pending;
  }
  $('display-status').textContent = displayModel.message;
  $('retry-display').hidden = displayModel.ready || displayModel.pending;
  if (!displayModel.value.showUninstalledSize) onlineSizes.clearQueue();
  // The service resumes genres when the switch is turned on; follow its progress.
  if (displayModel.ready && displayModel.value.showUninstalledSize && storeDetails.progress?.state === 'disabled' && !storeTimer) storeTimer = setTimeout(loadStoreDetails, 1000);
  else if (displayModel.ready && !displayModel.value.showUninstalledSize && storeDetails.progress && ['loading', 'blocked'].includes(storeDetails.progress.state)) loadStoreDetails();
}
const loadDisplaySettings=()=>displayModel.load();
const setDisplaySetting=(key,value)=>displayModel.set(key,value);
function renderWindowsSettings() {
  for (const key of ['desktopShortcut', 'startup']) {
    $(key).checked = windowsModel.value[key];
    $(key).disabled = !windowsModel.ready || windowsModel.pending || !windowsModel.value.supported;
  }
  $('windows-status').textContent = windowsModel.message;
  $('retry-windows').hidden = windowsModel.ready || windowsModel.pending || !windowsModel.value.supported;
}
const loadWindowsSettings=()=>windowsModel.load();
const setWindowsSetting=(key,value)=>windowsModel.set(key,value);
function renderAppSettings() {
  for (const key of Object.keys(APP_DEFAULTS)) {
    $(key).checked = appModel.value[key];
    $(key).disabled = !appModel.ready || appModel.pending;
  }
  $('app-settings-status').textContent = appModel.message;
  $('retry-app-settings').hidden = appModel.ready || appModel.pending;
}
const loadAppSettings=()=>appModel.load();
const setAppSetting=(key,value)=>appModel.set(key,value);
function lastPlayedLabel(game) {
  if (!game.lastPlayed) return 'Самое время познакомиться поближе.';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - game.lastPlayed) / 86400));
  if (days === 0) return 'Ты уже заглядывал сюда сегодня. Продолжим?';
  return tr(`Последний запуск: ${new Date(game.lastPlayed * 1000).toLocaleDateString('ru-RU')}. Почему бы не вернуться?`, `Last played: ${new Date(game.lastPlayed * 1000).toLocaleDateString(getLocale())}. Why not return?`);
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
  if (mode === 'recent') return tr('Запускались за 30 дней', 'Played in the last 30 days');
  if (STORE_FEATURES.includes(mode)) return featureLabel(mode);
  if (mode.startsWith('genre:')) return genreLabel(mode.slice(6), storeDetails.names);
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
  // Offer continuing played games only when local Steam data has launch dates.
  if (drawValue === 'recent' || scopedGames().some(hasPlayed)) drawOptions.push(['recent', tr('Запускались за 30 дней', 'Played in the last 30 days')]);
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
  // Store play modes and genres appear once Steam Store confirmed them for a game.
  const scoped = scopedGames();
  const features = STORE_FEATURES.filter(feature => drawValue === feature || scoped.some(game => game.store?.features?.[feature]));
  const genres = libraryGenres(scoped).map(([id]) => id);
  if (drawValue.startsWith('genre:') && !genres.includes(drawValue.slice(6))) genres.push(drawValue.slice(6));
  for (const [label, values] of [[tr('Режим игры', 'Play mode'), features.map(feature => [feature, featureLabel(feature)])], [tr('Жанры', 'Genres'), genres.map(id => [`genre:${id}`, genreLabel(id, storeDetails.names)])]]) {
    if (!values.length) continue;
    const group = document.createElement('optgroup'); group.label = label;
    for (const [value, text] of values) { const option = element('option', '', text); option.value = value; group.append(option); }
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
  $('excluded-count').textContent = scoped.length - participating.length;
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
  $('pool-note').textContent = !profileReady ? (profilePending || !snapshot ? 'Загружаем сохранённые категории и историю.' : tr('Не удалось прочитать сохранённые данные. Нажми «Обновить список».', 'Could not read saved data. Press “Refresh list”.')) : !scoped.length ? 'Добавь библиотеку, чтобы начать.' : !drawingPool.length ? `В режиме «${modeLabel()}» нет подходящих игр.` : state.noRepeats && played === drawingPool.length ? 'Следующий выбор начнёт новый круг.' : `${modeLabel()}: ${drawingPool.length}. У каждой игры равный шанс.`;
  $('draw-label').textContent = busy ? 'Выбираем…' : scoped.some(game => game.id === previewId) ? 'Предложить другую' : 'Выбрать игру';
  $('online-size-note').hidden = !state.includeUninstalled || !displayModel.value.showUninstalledSize;
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
function renderHeroCategoryMenu(game) {
  const menu = $('hero-category-menu');
  const blocked = busy || scanning || profilePending || !profileReady;
  menu.inert = blocked;
  menu.querySelector('summary').setAttribute('aria-disabled', String(blocked));
  menu.hidden = !game;
  if (!game) { menu.open = false; $('hero-category-options').replaceChildren(); return; }
  if (blocked) { menu.open = false; return; }
  const fragment = document.createDocumentFragment();
  const assigned = new Set(profile.assignments[game.id] ?? []);
  for (const category of profile.categories) {
    const label = element('label', 'hero-category-option');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = assigned.has(category.id);
    checkbox.disabled = !profileReady || profilePending || busy || scanning;
    checkbox.setAttribute('aria-label', tr(`Категория ${category.name}: ${game.name}`, `Category ${category.name}: ${game.name}`));
    checkbox.addEventListener('change', async () => {
      const next = checkbox.checked;
      const saved = await mutateProfile(revision => profileClient.setCategory(revision, game.id, category.id, next), next ? `Добавлено в «${category.name}»` : `Убрано из «${category.name}»`);
      if (!saved) checkbox.checked = !next;
    });
    label.append(checkbox, categoryBadge(category));
    fragment.append(label);
  }
  if (!profile.categories.length) fragment.append(element('p', 'hero-category-empty', 'Категорий пока нет. Создай первую подборку.'));
  const manage = element('button', 'button button-quiet hero-category-manage', profile.categories.length ? 'Управлять категориями' : 'Создать категорию');
  manage.type = 'button'; manage.addEventListener('click', () => { menu.open = false; openCategories(game.id); });
  fragment.append(manage);
  $('hero-category-options').replaceChildren(fragment);
}
function libraryCategoryMenu(game) {
  const menu = element('details', 'library-category-menu');
  menu.dataset.gameId = game.id;
  menu.open = libraryCategoryMenuId === game.id;
  const summary = element('summary', 'card-category-button');
  summary.setAttribute('role', 'button');
  summary.setAttribute('aria-expanded', String(menu.open));
  summary.setAttribute('aria-label', tr(`Категории: ${game.name}`, `Categories: ${game.name}`));
  summary.append(icon('tag'), element('span', '', 'Категории'));
  menu.addEventListener('toggle', () => {
    if (!menu.isConnected) return;
    summary.setAttribute('aria-expanded', String(menu.open));
    if (menu.open) {
      populateOptions();
      libraryCategoryMenuId = game.id;
      for (const other of $('game-grid').querySelectorAll('details[open]')) if (other !== menu) other.open = false;
      const bounds = menu.getBoundingClientRect();
      const workspaceBounds = document.querySelector('main').getBoundingClientRect();
      const width = options.getBoundingClientRect().width;
      options.style.left = `${Math.max(workspaceBounds.left + 8 - bounds.left, Math.min(0, workspaceBounds.right - 24 - bounds.left - width))}px`;
      options.classList.toggle('opens-up', bounds.bottom + options.scrollHeight + 12 > workspaceBounds.bottom);
    } else if (libraryCategoryMenuId === game.id) libraryCategoryMenuId = null;
  });
  const options = element('div', 'library-category-options');
  function populateOptions() {
    if (options.childElementCount) return;
    const assigned = new Set(profile.assignments[game.id] ?? []);
    for (const category of profile.categories) {
      const label = element('label', 'hero-category-option');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = assigned.has(category.id);
      checkbox.disabled = !profileReady || profilePending || busy || scanning;
      checkbox.id = `quick-category-${game.id}-${category.id}`;
      checkbox.setAttribute('aria-label', tr(`Категория ${category.name}: ${game.name}`, `Category ${category.name}: ${game.name}`));
      checkbox.addEventListener('change', async () => {
        const next = checkbox.checked;
        libraryCategoryMenuId = game.id;
        await mutateProfile(revision => profileClient.setCategory(revision, game.id, category.id, next), next ? `Добавлено в «${category.name}»` : `Убрано из «${category.name}»`);
        document.getElementById(checkbox.id)?.focus({ preventScroll: true });
      });
      label.append(checkbox, categoryBadge(category)); options.append(label);
    }
    const manage = element('button', 'text-button', 'Управлять категориями');
    manage.type = 'button'; manage.addEventListener('click', () => openCategories(game.id));
    options.append(manage);
  }
  if (menu.open) populateOptions();
  menu.append(summary, options);
  return menu;
}
function renderHeroDescription(game) {
  const cached = descriptions.get(game.id, appearance.value.language);
  const description = cached ?? game.storeDescriptions?.[appearance.value.language];
  const context = game.installed === false ? 'Игра есть в библиотеке аккаунта, но не установлена на этом компьютере. Steam предложит выбрать диск и начать загрузку.' : lastPlayedLabel(game);
  // Decorative frames can use local game details immediately, even offline.
  $('hero-description').textContent = description?.description ?? (busy ? context : description?.status === 'loading' ? 'Загружаем краткое описание из Steam Store…' : context);
  $('hero-context').textContent = context;
  $('hero-context').title = context;
  $('hero-context').hidden = !description?.description && (busy || description?.status !== 'loading');
  descriptionDisclosure.refresh(game.id);
}
function renderHero() {
  const scoped = scopedGames();
  const selected = animationGame ?? scoped.find(game => game.id === previewId);
  const game = selected ?? scoped.find(item => !state.excluded.includes(item.id)) ?? scoped[0];
  heroGameId = game?.id ?? null;
  if (game) syncOnlineSize(game);
  heroArtwork.show(game);
  renderHeroBadges(game);
  renderCategoryBadges($('hero-categories'), game?.id);
  if (animationGame && $('hero-categories').hidden) {
    $('hero-categories').hidden = false;
    $('hero-categories').append(element('span', 'category-badge category-badge-empty', tr('Без категории', 'Uncategorized')));
  }
  if (!animationGame) requestOnlineSize(game, true);
  renderHeroCategoryMenu(selected);
  $('play-button').hidden = !selected;
  $('play-button').disabled = busy || scanning || launching || updateApplying;
  $('toggle-description').disabled = busy;
  $('hero-size-source').inert = busy;
  $('spotlight').setAttribute('aria-busy', String(busy));
  $('hero-participation').hidden = !selected || !state.excluded.includes(selected.id);
  $('exclude-current').hidden = !selected;
  $('exclude-current').disabled = busy || scanning || savingExclusion || !exclusionsReady;
  if (selected) {
    const participation = participationDetails(state.excluded.includes(selected.id));
    $('hero-participation').dataset.state = participation.state;
    $('hero-participation-status').replaceChildren(icon(participation.icon), document.createTextNode(participation.label));
    $('exclude-current').replaceChildren(icon(participation.state === 'excluded' ? 'check' : 'close'));
    $('exclude-current').setAttribute('aria-label', participation.action);
    $('exclude-current').title = participation.action;
  }
  if (selected) {
    if (!animationGame) requestGameDescription(selected);
    $('spotlight-tag').textContent = busy ? 'ВЫБИРАЕМ ИГРУ' : previewId === state.current ? 'ТВОЙ ВЫБОР' : 'ПРОСМОТР ИГРЫ';
    $('hero-kicker').textContent = selected.installed === false ? 'Доступна для установки' : selected.updateRequired ? 'Перед запуском нужно обновление' : 'Готова к запуску';
    document.querySelector('.hero-state').dataset.status = selected.installed === false ? 'install' : selected.updateRequired ? 'update' : 'ready';
    $('hero-title').textContent = selected.name;
    $('hero-title').title = selected.name;
    renderHeroDescription(selected);
    const action = gameAction(selected);
    $('play-label').textContent = action.label;
    const needsUpdate = selected.installed !== false && selected.updateRequired;
    $('play-button').title = needsUpdate ? tr('Steam обновит игру и затем запустит её.', 'Steam will update the game and then launch it.') : action.label;
    $('play-icon').replaceChildren(icon(needsUpdate ? 'refresh' : selected.installed === false ? 'download' : 'play').firstElementChild);
    $('cover-caption').textContent = 'Обложка из твоей библиотеки Steam';
  } else {
    const loadingLibrary = !snapshot && !scanFailed;
    $('spotlight-tag').textContent = 'ТВОЯ СЛЕДУЮЩАЯ ИГРА';
    $('hero-kicker').textContent = loadingLibrary ? 'ПОДКЛЮЧЕНО К STEAM' : scoped.length ? 'БИБЛИОТЕКА ПОЛНА ВОЗМОЖНОСТЕЙ' : 'НАЧНЁМ С ТВОЕЙ БИБЛИОТЕКИ';
    document.querySelector('.hero-state').dataset.status = 'ready';
    $('hero-title').textContent = loadingLibrary ? 'Проверяем библиотеку Steam' : scoped.length ? 'Следующая игра - в один клик' : 'Подключи библиотеку Steam';
    $('hero-description').textContent = loadingLibrary ? 'Собираем установленные игры из Steam…' : scoped.length ? 'Нажми «Выбрать игру». Здесь появятся обложка, описание и кнопка запуска.' : 'Открой «Папки Steam» слева и укажи папку клиента или SteamLibrary.';
    $('hero-context').hidden = true;
    $('cover-caption').textContent = game ? `На обложке: ${game.name}` : '';
  }
  descriptionDisclosure.refresh(selected?.id ?? null);
}
async function launchSelectedGame() {
  const game = scopedGames().find(item => item.id === previewId);
  if (!game || launching || busy || scanning || updateApplying) return;
  launching = true;
  renderHero();
  try {
    const result = await systemClient.launchGame(game.id);
    toast(result.action === 'install' ? 'Steam открыт для установки игры.' : game.updateRequired ? tr('Steam открыт для обновления и запуска игры.', 'Steam opened to update and launch the game.') : 'Игра передана в Steam.');
  } catch (error) {
    toast(error instanceof TypeError ? 'Нет связи с Play Next. Запусти программу и повтори.' : error.message);
  } finally {
    launching = false;
    renderHero();
  }
}

async function setExcluded(id, excluded, { notify = true } = {}) {
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
    if (notify) {
      const name = games.find(game => game.id === id)?.name ?? id;
      toast(tr(`${name}: ${excluded ? 'исключена из выбора' : 'снова участвует'}`, `${name}: ${excluded ? 'excluded from picks' : 'included again'}`), {
        label: tr('Отменить', 'Undo'),
        async run() {
          if (state.excluded.includes(id) !== excluded) return true;
          const saved = await setExcluded(id, !excluded, { notify: false });
          if (saved) {
            toast('Участие игры восстановлено');
            document.getElementById(`toggle-${id}`)?.focus({ preventScroll: true });
          }
          return saved;
        },
      });
    }
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
  // Hidden pages are refreshed when opened. Do not build hundreds of cards or
  // offscreen category controls while drawing a game or saving a setting.
  if (workspace && workspace.current !== 'library') {
    requestOnlineSize(games.find(game => game.id === heroGameId), true);
    return;
  }
  $('online-size-note').hidden = !state.includeUninstalled || !displayModel.value.showUninstalledSize;
  const term = $('search-input').value.trim().toLocaleLowerCase('ru');
  const hasFilters = !!term || categoryFilter !== 'all' || libraryView.status !== 'all' || genreFilter !== 'all' || featureFilter !== 'all';
  renderActiveFilters();
  renderStoreFilters(scopedGames());
  filterPresets.render();
  $('clear-search').hidden = !$('search-input').value;
  $('reset-library-filters').hidden = !hasFilters;
  const excluded = new Set(state.excluded);
  const scoped = scopedGames();
  const visible = sortLibraryGames(filterLibraryGames(scoped, { filter, excluded: state.excluded, category: categoryFilter, assignments: profile.assignments, query: term, status: libraryView.status, genre: genreFilter, feature: featureFilter }), libraryView.sort, getLocale());
  $('game-grid').dataset.view = libraryView.view;
  renderLibraryCards({ $, element, icon, artwork, renderCardSize, renderCategoryBadges, libraryCategoryMenu,
    onPreview(id){previewId=id;renderHero();workspace.navigate('choose');},onExcluded:setExcluded,
  }, {visible,excluded,busy,scanning,savingExclusion,exclusionsReady});
  if (displayModel.value.showUninstalledSize && state.includeUninstalled) {
    requestOnlineSize(games.find(game => game.id === heroGameId), true);
    if (sizeObserver) {
      for (const node of $('game-grid').querySelectorAll('[data-size-id]')) {
        if (visible.some(game => game.id === node.dataset.sizeId && game.installed === false)) sizeObserver.observe(node);
      }
    } else visible.filter(game => game.installed === false).slice(0, 12).forEach(game => requestOnlineSize(game));
  }
  $('game-grid').setAttribute('aria-busy', String(scanning));
  $('empty-state').hidden = !!visible.length;
  $('search-note').hidden = !hasFilters;
  $('visible-count').textContent = `Показано ${visible.length} из ${scoped.length} игр`;
  if (!visible.length) {
    $('empty-title').textContent = !scoped.length ? 'Игры пока не найдены' : hasFilters ? 'Ничего не нашлось' : filter === 'excluded' ? 'Все игры в деле' : 'Все игры исключены';
    $('empty-description').textContent = !scoped.length ? state.includeUninstalled ? 'Открой библиотеку в Steam онлайн и обнови список. При необходимости укажи папку клиента Steam.' : 'Укажи папку Steam или SteamLibrary. Сейчас учитываем только установки на диске.' : libraryView.status === 'uninstalled' && !state.includeUninstalled ? 'Включи «Показывать неустановленные игры» над списком, чтобы увидеть всю библиотеку Steam.' : hasFilters ? 'Сбрось поиск или выбери другой фильтр.' : filter === 'excluded' ? 'Исключённые игры появятся здесь. Сейчас каждая может выпасть.' : 'Открой вкладку «Исключены» и верни игры в розыгрыш.';
    $('empty-action').textContent = !scoped.length ? 'Указать папку' : hasFilters ? 'Сбросить фильтры' : 'Показать все игры';
  }
}
function renderHistory() {
  const scoped = scopedGames();
  const entries = state.history.map(entry => ({ ...entry, game: scoped.find(game => game.id === entry.id) })).filter(entry => entry.game).slice(0, 7);
  const fragment = document.createDocumentFragment();
  for (const [i, entry] of entries.entries()) {
    const button = element('button', 'history-item');
    button.type = 'button';
    button.title = `${entry.game.name} · ${new Date(entry.at).toLocaleString(getLocale())}`;
    const image = artwork(entry.game); image.className = 'history-image';
    button.append(element('span', 'history-index', String(i + 1).padStart(2, '0')), image, element('span', '', entry.game.name));
    button.addEventListener('click', () => { if (!busy) { previewId = entry.game.id; renderHero(); workspace.navigate('choose'); } });
    fragment.append(button);
  }
  if (!entries.length) fragment.append(element('p', 'history-empty', 'Здесь появятся выбранные игры. Нажми «Выбрать игру», чтобы начать.'));
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

function sameIds(left, right) {
  return left.size === right.size && [...left].every(id => right.has(id));
}
function categoryDraftDirty() { return !sameIds(categoryDraft, categoryDraftOriginal); }
function resolveCategoryDraft(proceed) {
  if (profilePending || $('decision-dialog').open) return;
  decisions.request({ title: tr('Сохранить изменения подборки?', 'Save collection changes?'),
    message: tr('Ты изменил состав игр. Сохрани подборку перед переходом или продолжи без этих изменений.', 'You changed the games in this collection. Save before leaving, or continue without these changes.'),
    onSave: saveCategoryDraft,
    onDiscard: () => { categoryDraft = new Set(categoryDraftOriginal); renderCategoryGameList(); }, proceed });
}
function selectCategory(categoryId, { force = false } = {}) {
  if (!force && categorySelectedId !== categoryId && categoryDraftDirty()) { resolveCategoryDraft(() => selectCategory(categoryId, { force: true })); return false; }
  categorySelectedId = profile.categories.some(item => item.id === categoryId) ? categoryId : profile.categories[0]?.id ?? null;
  categoryDraft = new Set(games.filter(game => (profile.assignments[game.id] ?? []).includes(categorySelectedId)).map(game => game.id));
  categoryDraftOriginal = new Set(categoryDraft);
  categoryDraftRevision = profile.revision;
  renderCategoriesDialog();
  return true;
}
function visibleCategoryGames() {
  return collectionView(games, { query: $('category-search').value, filter: categoryGameFilter,
    draft: categoryDraft, focusId: categoryFocusGameId, locale: getLocale() });
}
function renderCategoryDraftSummary(visible) {
  const changes = collectionChanges(categoryDraftOriginal, categoryDraft);
  const changed = changes.added + changes.removed;
  const hasFilters = !!$('category-search').value || categoryGameFilter !== 'all';
  $('category-clear-search').hidden = !$('category-search').value;
  $('category-reset-filters').hidden = !hasFilters;
  $('category-visible-count').textContent = tr(`Показано ${visible.length} из ${games.length} игр`, `Showing ${visible.length} of ${games.length} games`);
  $('category-draft-count').textContent = changed
    ? tr(`В подборке: ${changes.total} · добавить: ${changes.added}, убрать: ${changes.removed}`, `In collection: ${changes.total} · add: ${changes.added}, remove: ${changes.removed}`)
    : tr(`В подборке: ${changes.total} · изменений нет`, `In collection: ${changes.total} · no changes`);
  const locked = !profileReady || profilePending || scanning;
  $('category-save').disabled = !changed || locked;
  $('category-cancel').disabled = !changed || profilePending;
  $('category-draw').disabled = !categorySelectedId || !!changed || locked;
  const add = visible.filter(game => !categoryDraft.has(game.id)).length;
  const remove = visible.length - add;
  $('category-add-visible').textContent = tr(`Добавить найденные (${add})`, `Add visible (${add})`);
  $('category-remove-visible').textContent = tr(`Убрать найденные (${remove})`, `Remove visible (${remove})`);
  $('category-add-visible').disabled = !add || locked;
  $('category-remove-visible').disabled = !remove || locked;
}
function resetCategoryFilters() {
  $('category-search').value = ''; categoryGameFilter = 'all';
  for (const button of document.querySelectorAll('.category-game-filter')) {
    const active = button.dataset.categoryFilter === 'all';
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  renderCategoryGameList();
}
function renderCategoryGameList() {
  const visible = visibleCategoryGames();
  const fragment = document.createDocumentFragment();
  for (const game of visible) {
    const label = element('label', 'category-game-row' + (game.id === categoryFocusGameId ? ' category-game-focus' : ''));
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = categoryDraft.has(game.id); input.disabled = !profileReady || profilePending;
    input.setAttribute('aria-label', tr(`Добавить в категорию: ${game.name}`, `Add to category: ${game.name}`));
    input.id = `category-game-${game.id}`;
    input.addEventListener('change', () => {
      if (input.checked) categoryDraft.add(game.id); else categoryDraft.delete(game.id);
      const target = collectionFocusAfterToggle(visible, game.id, categoryDraft, categoryGameFilter);
      // In the full list a check only changes the draft and summary, not hundreds
      // of DOM rows. Filtered rows may disappear, so restore the next valid target.
      if (categoryGameFilter === 'all') renderCategoryDraftSummary(visible);
      else {
        const scroll = $('category-game-list').scrollTop;
        renderCategoryGameList(); $('category-game-list').scrollTop = scroll;
      }
      if (target) document.getElementById(`category-game-${target}`)?.focus();
      else $('category-search').focus({ preventScroll: true });
    });
    const copy = element('span', 'category-game-copy');
    copy.title = game.name;
    copy.append(element('strong', '', game.name), element('small', '', game.installed === false ? 'Не установлена' : 'Установлена'));
    label.append(input, copy);
    fragment.append(label);
  }
  if (!visible.length) fragment.append(element('p', 'category-empty', 'По этому фильтру игр не найдено.'));
  $('category-game-list').replaceChildren(fragment);
  renderCategoryDraftSummary(visible);
}
function renderCategoriesDialog() {
  // Build collection rows only when that workspace is visible. Opening it
  // refreshes the draft from the saved revision, so hidden menus need no rebuild.
  if (workspace && workspace.current !== 'categories') return;
  if (profile.categories.length && !profile.categories.some(item => item.id === categorySelectedId)) {
    categorySelectedId = profile.categories[0].id;
    categoryDraft = new Set(games.filter(game => (profile.assignments[game.id] ?? []).includes(categorySelectedId)).map(game => game.id));
    categoryDraftOriginal = new Set(categoryDraft);
    categoryDraftRevision = profile.revision;
  } else if (!profile.categories.length) {
    categorySelectedId = null; categoryDraft = new Set(); categoryDraftOriginal = new Set();
  } else if (!categoryDraftDirty() && categoryDraftRevision !== profile.revision) {
    categoryDraft = new Set(games.filter(game => (profile.assignments[game.id] ?? []).includes(categorySelectedId)).map(game => game.id));
    categoryDraftOriginal = new Set(categoryDraft); categoryDraftRevision = profile.revision;
  }
  $('category-editor-title').textContent = profile.categories.find(category => category.id === categorySelectedId)?.name ?? 'Игры в подборке';
  $('category-editor-title').title = $('category-editor-title').textContent;
  $('category-draw').disabled = !categorySelectedId || categoryDraftDirty() || !profileReady || profilePending || scanning;
  const picker = document.createDocumentFragment();
  const counts = collectionCounts(games, profile.assignments);
  for (const category of profile.categories) {
    const count = counts.get(category.id) ?? 0;
    const button = element('button', `category-picker-button category-${category.color}`);
    button.type = 'button'; button.disabled = !profileReady || profilePending;
    button.classList.toggle('active', category.id === categorySelectedId);
    button.setAttribute('aria-pressed', String(category.id === categorySelectedId));
    button.append(element('span', '', category.name), element('small', '', String(count)));
    button.addEventListener('click', () => { if (selectCategory(category.id)) $('category-search').focus({ preventScroll: true }); });
    picker.append(button);
  }
  if (!profile.categories.length) picker.append(element('p', 'category-empty', 'Категорий пока нет. Создай первую подборку ниже.'));
  $('category-picker').replaceChildren(picker);
  $('category-bulk-editor').hidden = !categorySelectedId;
  if (categorySelectedId) renderCategoryGameList();

  const list = document.createDocumentFragment();
  for (const category of profile.categories) {
    const row = element('form', 'category-manage-row');
    const marker = categoryBadge(category); marker.textContent = ''; marker.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.value = category.name; input.maxLength = 32; input.required = true;
    input.setAttribute('aria-label', `Название категории ${category.name}`); input.disabled = !profileReady || profilePending;
    const saveButton = element('button', 'button button-quiet', 'Сохранить'); saveButton.type = 'submit';
    const deleteButton = element('button', 'icon-button'); deleteButton.type = 'button'; deleteButton.append(icon('close'));
    deleteButton.title = 'Удалить категорию'; deleteButton.setAttribute('aria-label', `Удалить категорию ${category.name}`);
    saveButton.disabled = deleteButton.disabled = !profileReady || profilePending;
    row.addEventListener('submit', event => { event.preventDefault(); renameCategory(category.id, input.value); });
    deleteButton.addEventListener('click', () => {
      const ask = () => decisions.request({ title: tr('Удалить категорию?', 'Delete category?'),
        message: tr(`Будет удалена только подборка «${category.name}». Игры и их участие в выборе не изменятся.`, `Only the collection “${category.name}” will be deleted. Games and their participation in picks remain unchanged.`),
        discardLabel: tr('Удалить категорию', 'Delete category'), cancelLabel: tr('Отменить', 'Cancel'), danger: true,
        onDiscard: () => deleteCategory(category.id) });
      if (categoryDraftDirty()) resolveCategoryDraft(ask); else ask();
    });
    row.append(marker, input, saveButton, deleteButton); list.append(row);
  }
  if (!profile.categories.length) list.append(element('p', 'category-empty', 'Создай первую подборку.'));
  $('category-list').replaceChildren(list);
  $('category-name').disabled = !profileReady || profilePending || profile.categories.length >= 20;
  $('add-category-form').querySelector('button').disabled = !profileReady || profilePending || profile.categories.length >= 20;
  $('category-status').textContent = profilePending ? 'Сохраняем изменения…' : profileReady ? `Категорий: ${profile.categories.length} из 20. Отметь нужные игры и нажми «Сохранить».` : 'Категории недоступны. Нажми «Обновить список» в библиотеке.';
}
function openCategories(gameId = null) {
  if (categoryDraftDirty()) { resolveCategoryDraft(() => openCategories(gameId)); return; }
  categoryFocusGameId = gameId;
  // Opening a particular game must not hide it behind an earlier search/filter.
  if (gameId) resetCategoryFilters();
  const assigned = gameId ? profile.assignments[gameId] ?? [] : [];
  selectCategory(assigned.find(id => profile.categories.some(item => item.id === id)) ?? categorySelectedId ?? profile.categories[0]?.id ?? null, { force: true });
  workspace.navigate('categories');
  if (gameId) requestAnimationFrame(() => $('category-game-list').querySelector('.category-game-focus')?.scrollIntoView({ block: 'center' }));
}
async function mutateProfile(operation, successMessage) {
  if (!profileReady || profilePending || busy || scanning) return false;
  profilePending = true;
  renderCounts(); renderHero(); renderGrid(); renderCategoriesDialog();
  try {
    applyProfile(await operation(profile.revision), { resetPreview: false });
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
const renameCategory = (id, name) => mutateProfile(revision => profileClient.renameCategory(revision, id, name), 'Категория переименована');
const deleteCategory = id => mutateProfile(revision => profileClient.deleteCategory(revision, id), 'Категория удалена');
async function saveCategoryDraft() {
  if (!categorySelectedId || !categoryDraftDirty()) return true;
  const selected = categorySelectedId;
  const saved = await mutateProfile(revision => profileClient.setCategoryGames(revision, selected, [...categoryDraft], games.map(game => game.id)), 'Подборка сохранена');
  if (saved) selectCategory(selected, { force: true });
  return saved;
}

async function draw() {
  if (busy || scanning || savingExclusion || !exclusionsReady || !profileReady || profilePending || !eligible().length) return;
  busy = true;
  animationGame = scopedGames().find(game => game.id === previewId) ?? eligible()[0];
  let result, committed = false, saving = false;
  try {
    renderCounts(); renderHero(); renderGrid(); renderHistory();
    // Another browser/port may have changed the shared profile or exclusions since our scan.
    const [, loaded] = await Promise.all([loadExclusions(), loadProfile()]);
    if (!loaded) throw new Error('Сохранённый профиль сейчас недоступен.');
    if (!eligible().length) return;
    result = drawGame(games, state, undefined, undefined, profile.assignments);
    // Frames never modify the profile, history, exclusions or the random bag.
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sequence = reducedMotion ? [] : animationGames(eligible(), 8);
    descriptions.clearQueue();
    requestGameDescription(result.game);
    if (sequence.length) {
      $('spotlight').style.setProperty('--draw-card-height', `${$('spotlight').getBoundingClientRect().height}px`);
      $('spotlight').classList.add('is-drawing');
      for (const game of sequence) descriptions.request(game.id, appearance.value.language);
      await playDrawFrames(sequence, {
        prepare: () => heroArtwork.preload([...sequence, result.game]),
        render(game) { animationGame = game; renderHero(); },
      });
    }
    descriptions.clearQueue();
    animationGame = result.game;
    renderHero();
    saving = true;
    profilePending = true;
    applyProfile(await profileClient.replaceDraw(profile.revision, drawSnapshot(result.state)));
    profileReady = true;
    previewId = result.game.id;
    committed = true;
    $('error-banner').hidden = true;
  } catch (error) {
    profileFailure(error, saving ? 'Игра выбрана, но результат не удалось сохранить, поэтому розыгрыш отменён.' : 'Не удалось завершить выбор игры.');
  } finally {
    animationGame = null;
    descriptions.clearQueue();
    $('spotlight').classList.remove('is-drawing');
    $('spotlight').style.removeProperty('--draw-card-height');
    busy = false; profilePending = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid();
  }
  if (!committed) return;
  toast(result.newCycle ? `Новый круг. Сегодня - ${result.game.name}` : `Твой выбор: ${result.game.name}`);
  if (matchMedia('(max-width: 640px)').matches) {
    $('spotlight').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
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
  if (snapshot?.scannedAt) notes.push(tr(`Последняя проверка: ${new Date(snapshot.scannedAt).toLocaleTimeString('ru-RU')}.`, `Last checked: ${new Date(snapshot.scannedAt).toLocaleTimeString(getLocale())}.`));
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
    await Promise.all([loadExclusions(), loadDisplaySettings(), loadAppSettings(), loadProfile()]);
    startup.stage(tr('Собираем твои игры…', 'Collecting your games…'));
    const paths = addedPath ? [...state.customPaths, addedPath] : state.customPaths;
    const response = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' }, body: JSON.stringify({ paths, includeUninstalled: state.includeUninstalled }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Не удалось прочитать библиотеки.');
    snapshot = data; games = data.games; applyStoreDetails(); heroArtwork.reset();
    scanFailed = false;
    if (addedPath) {
      const failed = data.warnings.some(warning => warning.startsWith('Не найдена папка steamapps:') && warning.includes(addedPath));
      if (failed) { $('path-error').textContent = 'В этой папке не найдена steamapps. Проверь путь и подключение диска.'; $('path-error').hidden = false; }
      else { state.customPaths = [...new Set(paths)]; save(); $('path-input').value = ''; toast('Библиотека добавлена'); }
    }
    success = true;
  } catch (error) {
    scanFailed = true;
    const message = error instanceof TypeError ? 'Связь прервалась. Приложение попробует восстановить её автоматически.' : error.message;
    $('error-banner').textContent = message; $('error-banner').hidden = false;
    if ($('libraries-dialog').open) { $('path-error').textContent = message; $('path-error').hidden = false; }
  } finally {
    scanning = false;
    $('refresh-button').classList.remove('is-refreshing');
    $('path-input').disabled = false;
    $('add-path-form').querySelector('button').disabled = false;
    renderCounts(); renderHero(); renderHistory(); renderGrid(); renderLibraries();
  }
  if (success) loadStoreDetails({ reset: true });
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
$('clear-search').addEventListener('click', () => { $('search-input').value = ''; renderGrid(); $('search-input').focus(); });
$('search-input').addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.value) { event.preventDefault(); event.stopPropagation(); event.target.value = ''; renderGrid(); }
});
$('reset-library-filters').addEventListener('click', resetLibraryFilters);
$('installation-filter').addEventListener('change', event => { libraryView.status = event.target.value; saveLibraryView(); });
for (const tab of document.querySelectorAll('.filter-tab')) tab.addEventListener('click', () => setFilter(tab.dataset.filter));
$('category-filter').addEventListener('change', event => { categoryFilter = event.target.value; renderGrid(); });
$('genre-filter').addEventListener('change', event => { genreFilter = event.target.value; renderGrid(); });
$('feature-filter').addEventListener('change', event => { featureFilter = event.target.value; renderGrid(); });
$('draw-mode').addEventListener('change', event => updateDraw({ mode: event.target.value }, `Режим выбора: ${event.target.options[event.target.selectedIndex].textContent}`));
$('no-repeats').addEventListener('change', event => updateDraw({ noRepeats: event.target.checked }));
$('reset-cycle').addEventListener('click', () => updateDraw({ seen: [] }, 'Новый круг: все подходящие игры снова доступны'));
$('clear-history').addEventListener('click', () => updateDraw({ history: [] }, 'История очищена. Текущий круг сохранён.'));
$('exclude-current').addEventListener('click', async () => {
  const id = previewId;
  if (id && await setExcluded(id, !state.excluded.includes(id))) $('exclude-current').focus({ preventScroll: true });
});
$('play-button').addEventListener('click', launchSelectedGame);
$('libraries-button').addEventListener('click', () => { renderLibraries(); $('libraries-dialog').showModal(); });
$('library-folders-shortcut').addEventListener('click', () => $('libraries-button').click());
$('retry-ui-settings').addEventListener('click', loadUiSettings);
$('retry-display').addEventListener('click', loadDisplaySettings);
$('retry-windows').addEventListener('click', loadWindowsSettings);
$('retry-app-settings').addEventListener('click', loadAppSettings);
$('check-update').addEventListener('click', () => checkForUpdate({ force: true }));
$('install-update').addEventListener('click', installUpdate);
$('cancel-update').addEventListener('click',()=>updates.cancel().catch(error=>toast(error.message)));
for (const key of Object.keys(DISPLAY_DEFAULTS)) $(key).addEventListener('change', event => setDisplaySetting(key, event.target.checked));
for (const key of ['desktopShortcut', 'startup']) $(key).addEventListener('change', event => setWindowsSetting(key, event.target.checked));
for (const key of Object.keys(APP_DEFAULTS)) $(key).addEventListener('change', event => setAppSetting(key, event.target.checked));
$('update-dialog-install').addEventListener('click', installUpdate);
$('update-dialog-later').addEventListener('click', () => $('update-dialog').close());
$('close-update-dialog').addEventListener('click', () => $('update-dialog').close());
$('disable-update-dialog').addEventListener('click', async () => { if (await setAppSetting('showUpdateNotifications', false)) $('update-dialog').close(); });
$('update-dialog').addEventListener('click', event => { if (event.target === $('update-dialog')) { const rect = $('update-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('update-dialog').close(); } });
$('interfaceLanguage').addEventListener('change', event => setUiSetting('language', event.target.value));
$('theme').addEventListener('change', event => setUiSetting('theme', event.target.value));
$('accent').addEventListener('change', event => { cancelAccentPreview(); setUiSetting('accent', event.target.value); });
$('randomize-accent').addEventListener('click', () => previewCustomAccent(createRandomAccent(), 'Случайная палитра включена для предпросмотра. Её можно изменить или сохранить.'));
for (const [id, key] of [['accent-base', 'base'], ['accent-hover', 'hover'], ['accent-contrast', 'contrast']]) {
  $(id).addEventListener('input', event => previewCustomAccent({ ...appearance.draft, [key]: event.target.value }));
}
$('save-custom-accent').addEventListener('click', saveCustomAccent);
$('cancel-accent-preview').addEventListener('click', cancelAccentPreview);
$('export-backup').addEventListener('click', exportBackup);
$('import-backup').addEventListener('click', () => $('backup-file').click());
$('backup-file').addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  await restoreBackup(file);
});
$('close-dialog').addEventListener('click', () => $('libraries-dialog').close());
$('libraries-dialog').addEventListener('click', event => { if (event.target === $('libraries-dialog')) { const rect = $('libraries-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('libraries-dialog').close(); } });
$('category-search').addEventListener('input', renderCategoryGameList);
$('category-clear-search').addEventListener('click', () => { $('category-search').value = ''; renderCategoryGameList(); $('category-search').focus(); });
$('category-search').addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.value) { event.preventDefault(); event.stopPropagation(); event.target.value = ''; renderCategoryGameList(); }
});
$('category-reset-filters').addEventListener('click', () => { resetCategoryFilters(); $('category-search').focus(); });
for (const button of document.querySelectorAll('.category-game-filter')) button.addEventListener('click', () => {
  categoryGameFilter = button.dataset.categoryFilter;
  for (const item of document.querySelectorAll('.category-game-filter')) { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }
  renderCategoryGameList();
});
$('category-add-visible').addEventListener('click', () => { for (const game of visibleCategoryGames()) categoryDraft.add(game.id); renderCategoryGameList(); });
$('category-remove-visible').addEventListener('click', () => { for (const game of visibleCategoryGames()) categoryDraft.delete(game.id); renderCategoryGameList(); });
$('category-cancel').addEventListener('click', () => { categoryDraft = new Set(categoryDraftOriginal); renderCategoryGameList(); });
$('category-save').addEventListener('click', saveCategoryDraft);
$('category-draw').addEventListener('click', async () => { if (categorySelectedId && !categoryDraftDirty() && await updateDraw({ mode: `category:${categorySelectedId}` })) workspace.navigate('choose'); });
$('add-category-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('category-name');
  const name = input.value.trim();
  if (categoryDraftDirty()) { resolveCategoryDraft(() => $('add-category-form').requestSubmit()); return; }
  if (name && await mutateProfile(revision => profileClient.addCategory(revision, name), 'Категория добавлена')) {
    input.value = '';
    selectCategory(profile.categories.at(-1)?.id, { force: true });
    $('category-search').focus();
  }
});
$('add-path-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('path-input').value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  if (!value || state.customPaths.includes(value)) return;
  if (state.customPaths.length >= 20) { $('path-error').textContent = 'Можно добавить не больше 20 ручных путей.'; $('path-error').hidden = false; return; }
  scan({ addedPath: value });
});
$('empty-action').addEventListener('click', () => { if (!scopedGames().length) $('libraries-dialog').showModal(); else resetLibraryFilters(); });
document.addEventListener('keydown', event => {
  if ($('update-dialog').open || $('libraries-dialog').open || $('decision-dialog').open || $('description-dialog').open) return;
  if (event.key === 'Escape') {
    if ($('hero-category-menu').open) { $('hero-category-menu').open = false; $('hero-category-menu').querySelector('summary').focus(); }
    libraryCategoryMenuId = null;
    for (const menu of $('game-grid').querySelectorAll('details[open]')) { menu.open = false; menu.querySelector('summary').focus(); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyF' || event.key.toLowerCase() === 'f')) {
    if (workspace.current === 'categories') { event.preventDefault(); $('category-search').focus(); return; }
    if (workspace.navigate('library', { focus: false })) { event.preventDefault(); $('search-input').focus(); }
    return;
  }
  if (workspace.current === 'categories' && (event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyS') {
    event.preventDefault(); saveCategoryDraft(); return;
  }
  if (workspace.current !== 'choose') return;
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target.closest('input,textarea,select,button,a,summary,[role="button"],[contenteditable="true"]')) return;
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
workspace = createWorkspace({ beforeChange(previous, next) {
  if (busy || (previous === 'categories' && profilePending)) return false;
  if (previous === 'categories' && categoryDraftDirty()) { resolveCategoryDraft(() => workspace.navigate(next)); return false; }
  if (previous === 'categories') { categoryDraft = new Set(categoryDraftOriginal); }
  if (previous === 'settings') cancelAccentPreview();
  return !busy;
}, onChange(page) {
  $('hero-category-menu').open = false;
  libraryCategoryMenuId = null;
  if (page === 'categories') renderCategoriesDialog();
  if (page === 'library') renderGrid();
  if (page === 'choose') descriptionDisclosure.refresh();
  if (page === 'settings') { loadUiSettings(); loadDisplaySettings(); loadAppSettings(); loadWindowsSettings(); systemClient.loadUpdate().then(value => updates.setInfo(value)).catch(() => {}); }
} });
document.addEventListener('click', event => {
  if (!event.target.closest('.hero-category-menu')) $('hero-category-menu').open = false;
  if (event.target.closest('.library-category-menu')) return;
  libraryCategoryMenuId = null;
  for (const menu of $('game-grid').querySelectorAll('details[open]')) menu.open = false;
});
function renderActiveFilters() {
  const container = $('active-library-filters');
  const chips = [];
  const add = (label, remove) => {
    const button = element('button', 'filter-chip', label);
    button.type = 'button'; button.append(icon('close'));
    button.setAttribute('aria-label', tr(`Убрать фильтр: ${label}`, `Remove filter: ${label}`));
    button.addEventListener('click', () => { remove(); saveLibraryView(); $('search-input').focus({ preventScroll: true }); });
    chips.push(button);
  };
  const term = $('search-input').value.trim();
  if (term) add(tr(`Поиск: ${term}`, `Search: ${term}`), () => { $('search-input').value = ''; });
  if (categoryFilter !== 'all') add(profile.categories.find(category => category.id === categoryFilter)?.name ?? tr('Категория', 'Category'), () => { categoryFilter = 'all'; renderCategorySelectors(); });
  if (libraryView.status !== 'all') add(libraryView.status === 'installed' ? tr('Установленные', 'Installed') : tr('Неустановленные', 'Not installed'), () => { libraryView.status = 'all'; });
  if (genreFilter !== 'all') add(genreFilter === 'unknown' ? tr('Жанр не загружен', 'Genre not loaded') : genreLabel(genreFilter, storeDetails.names), () => { genreFilter = 'all'; });
  if (featureFilter !== 'all') add(featureLabel(featureFilter), () => { featureFilter = 'all'; });
  container.replaceChildren(...chips); container.hidden = !chips.length;
}
function renderLibraryView() {
  $('library-sort').value = libraryView.sort;
  $('installation-filter').value = libraryView.status;
  for (const button of document.querySelectorAll('[data-library-view]')) button.setAttribute('aria-pressed', String(button.dataset.libraryView === libraryView.view));
  renderGrid();
}
function currentLibraryFilters() {
  return { filter, category: categoryFilter, status: libraryView.status, sort: libraryView.sort, query: $('search-input').value.trim(), genre: genreFilter, feature: featureFilter };
}
function applyFilterPreset(preset) {
  const { filters } = preset;
  $('search-input').value = filters.query; libraryView.status = filters.status; libraryView.sort = filters.sort;
  genreFilter = filters.genre; featureFilter = filters.feature;
  categoryFilter = profile.categories.some(category => category.id === filters.category) ? filters.category : 'all';
  renderCategorySelectors(); setFilter(filters.filter); saveLibraryView();
}
function resetLibraryFilters() {
  $('search-input').value = ''; categoryFilter = 'all'; libraryView.status = 'all'; genreFilter = 'all'; featureFilter = 'all';
  renderCategorySelectors(); setFilter('all'); saveLibraryView();
}
function saveLibraryView() {
  try { localStorage.setItem(LIBRARY_VIEW_KEY, JSON.stringify(libraryView)); } catch { $('storage-banner').hidden = false; }
  renderLibraryView();
}
for (const button of document.querySelectorAll('[data-library-view]')) button.addEventListener('click', () => { libraryView.view = button.dataset.libraryView; saveLibraryView(); });
$('library-sort').addEventListener('change', event => { libraryView.sort = event.target.value; saveLibraryView(); });
renderLibraryView();
renderStoreStatus();
renderWindowsSettings();
renderAppSettings();
renderUpdateStatus();
renderUiSettings();
renderBackup();
connectBrowserSession({ onState(status, restored) {
  $('connection-status').dataset.state = status;
  $('connection-status').textContent = status === 'connected' ? tr('Подключено локально', 'Connected locally') : tr('Восстанавливаем связь…', 'Reconnecting…');
  $('connection-banner').hidden = status !== 'reconnecting';
  if (status === 'connected' && restored && scanFailed) scan();
} });
$('connection-retry').addEventListener('click', () => {
  if (window.chrome?.webview) window.chrome.webview.postMessage('recover');
  else location.reload();
});
loadUiSettings().finally(async () => {
  startup.stage(tr('Загружаем категории и настройки…', 'Loading collections and settings…'));
  try { await scan(); } finally { startup.finish(); }
  checkForUpdate({ notify: true });
});
