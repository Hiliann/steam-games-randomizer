import { onLanguageChange, tr } from './i18n.js';

export const PAGES = Object.freeze(['choose', 'library', 'categories', 'settings']);
export const LIBRARY_VIEW_KEY = 'playnext-library-view-v1';
export function cleanLibraryView(value) {
  return { view: value?.view === 'list' ? 'list' : 'grid', sort: ['name', 'recent', 'size'].includes(value?.sort) ? value.sort : 'name' };
}
export function sortLibraryGames(games, sort = 'name', locale = 'ru') {
  const size = game => {
    const bytes = game.installed === false ? game.onlineSize?.bytes ?? game.installSize?.bytes : game.size;
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : -1;
  };
  return [...games].sort((a, b) => {
    const order = sort === 'recent' ? (b.lastPlayed || 0) - (a.lastPlayed || 0) : sort === 'size' ? size(b) - size(a) : 0;
    return order || a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id));
  });
}

const labels = {
  choose: ['Выбор игры', 'Choose a game', 'Найди следующую игру из своей библиотеки Steam.', 'Find your next game in your Steam library.'],
  library: ['Библиотека', 'Library', 'Все игры, поиск и управление участием в случайном выборе.', 'Browse your games and choose which ones can appear in a draw.'],
  categories: ['Категории', 'Categories', 'Собери подборки для любого настроения.', 'Create collections for every mood.'],
  settings: ['Настройки', 'Settings', 'Настрой Play Next под себя. Изменения сохраняются автоматически.', 'Make Play Next yours. Changes are saved automatically.'],
};

export function createWorkspace({ document: doc = document, beforeChange = () => true, onChange = () => {} } = {}) {
  let current = 'choose';
  const main = doc.querySelector('main');
  const container = doc.getElementById('app-pages');
  // Keep all settings bindings and data clients intact while moving the former
  // modal contents into the application's single navigation workspace.
  for (const id of ['categories-dialog', 'settings-dialog']) container.append(doc.getElementById(id));
  const pages = [...doc.querySelectorAll('[data-workspace-page]')];
  const links = [...doc.querySelectorAll('[data-page]')];
  const positions = new Map();
  const updateHeader = () => {
    const [ru, en, descriptionRu, descriptionEn] = labels[current];
    doc.getElementById('page-title').textContent = tr(ru, en);
    doc.getElementById('page-subtitle').textContent = tr(descriptionRu, descriptionEn);
  };
  function navigate(page, { focus = true } = {}) {
    if (!PAGES.includes(page)) return false;
    if (page !== current && !beforeChange(current, page)) return false;
    const previous = current;
    positions.set(previous, main.scrollTop);
    current = page;
    for (const section of pages) section.hidden = section.dataset.workspacePage !== page;
    for (const link of links) {
      if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    updateHeader();
    if (previous !== page) {
      main.scrollTop = positions.get(page) ?? 0;
      if (focus) doc.getElementById('page-title').focus({ preventScroll: true });
      onChange(page, previous);
    }
    return true;
  }
  for (const link of links) {
    if (link.classList.contains('nav-item')) link.setAttribute('aria-label', link.textContent.trim());
    link.addEventListener('click', () => navigate(link.dataset.page));
  }
  const tabs = [...doc.querySelectorAll('[data-settings-tab]')];
  const panels = [...doc.querySelectorAll('[data-settings-panel]')];
  function selectTab(value, focus = false) {
    if (!tabs.some(tab => tab.dataset.settingsTab === value)) return;
    for (const tab of tabs) {
      const active = tab.dataset.settingsTab === value;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== value;
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => selectTab(tab.dataset.settingsTab));
    tab.addEventListener('keydown', event => {
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!offset && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
      selectTab(tabs[next].dataset.settingsTab, true);
    });
  }
  onLanguageChange(updateHeader);
  navigate('choose', { focus: false });
  return { navigate, selectTab, get current() { return current; } };
}
