import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanLibraryView, filterLibraryGames, sortLibraryGames, createWorkspace, PAGES } from '../public/workspace.js';
import { setLanguage, translate } from '../public/i18n.js';

test('library preferences normalize damaged values independently of saved profiles', () => {
  for (const value of [null, undefined, 0, {}, { view: 'x', sort: 'x', status: 'x' }]) assert.deepEqual(cleanLibraryView(value), { view: 'grid', sort: 'name', status: 'all' });
  assert.deepEqual(cleanLibraryView({ view: 'list', sort: 'recent', categories: [] }), { view: 'list', sort: 'recent', status: 'all' });
  assert.equal(cleanLibraryView({ status: 'uninstalled' }).status, 'uninstalled');
});

test('library search combines participation, installation and categories without changing the draw pool', () => {
  const games = [{ id: '1', name: 'Game A' }, { id: '2', name: 'Game B', installed: false }, { id: '3', name: 'OTHER', installed: true }];
  const original = structuredClone(games);
  const options = { excluded: ['1'], assignments: { '2': ['favorite'], '3': ['favorite'] } };
  const ids = extra => filterLibraryGames(games, { ...options, ...extra }).map(g => g.id);
  assert.deepEqual(ids({}), ['1', '2', '3']);
  assert.deepEqual(ids({ status: 'installed' }), ['1', '3']);
  assert.deepEqual(ids({ status: 'uninstalled' }), ['2']);
  assert.deepEqual(ids({ query: '  gAmE ', category: 'favorite', filter: 'included' }), ['2']);
  assert.deepEqual(ids({ filter: 'excluded', status: 'installed' }), ['1']);
  assert.deepEqual(ids({ filter: 'excluded', status: 'uninstalled' }), []);
  assert.deepEqual(games, original);
});
test('sorting is deterministic, does not mutate the draw pool and puts missing sizes last', () => {
  const games = [{ id: '1', name: 'Game 10' }, { id: '2', name: 'Game 2', size: 500, lastPlayed: 20 }, { id: '3', name: 'A', installed: false, installSize: { bytes: 600 }, lastPlayed: 10 }, { id: '4', name: 'B', installed: false, onlineSize: { bytes: 1000 } }];
  const original = structuredClone(games);
  assert.deepEqual(sortLibraryGames(games).map(g => g.id), ['3', '4', '2', '1']);
  assert.deepEqual(sortLibraryGames(games, 'recent').map(g => g.id), ['2', '3', '4', '1']);
  assert.deepEqual(sortLibraryGames(games, 'size').map(g => g.id), ['4', '3', '2', '1']);
  assert.deepEqual(games, original);
});

function fakeDocument() {
  const node = (dataset = {}) => ({ dataset, attrs: {}, hidden: true, tabIndex: 0, textContent: '', events: {}, children: [], classList: { contains: name => name === 'nav-item' },
    setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; },
    append(child) { this.children.push(child); }, addEventListener(name, callback) { this.events[name] = callback; }, focus() { this.focused = true; },
  });
  const pages = PAGES.map(page => node({ workspacePage: page }));
  const links = PAGES.map(page => { const link = node({ page }); link.textContent = page; return link; });
  const tabs = ['appearance', 'display', 'windows', 'updates', 'data'].map(settingsTab => node({ settingsTab }));
  const panels = tabs.map(tab => node({ settingsPanel: tab.dataset.settingsTab }));
  const ids = { 'app-pages': node(), 'categories-dialog': pages[2], 'settings-dialog': pages[3], 'page-title': node(), 'page-subtitle': node() };
  const main = { scrollTop: 0 };
  const doc = { getElementById: id => ids[id], querySelector: () => main,
    querySelectorAll: selector => ({ '[data-workspace-page]': pages, '[data-page]': links, '[data-settings-tab]': tabs, '[data-settings-panel]': panels })[selector],
  };
  return { doc, main, pages, links, tabs, panels, ids };
}
test('navigation shows one page, restores scroll and respects unsaved-change guards', () => {
  const fixture = fakeDocument();
  let dirty = false;
  const changes = [];
  const workspace = createWorkspace({ document: fixture.doc, beforeChange: page => !(page === 'categories' && dirty), onChange: page => changes.push(page) });
  assert.equal(workspace.current, 'choose');
  assert.deepEqual(fixture.pages.map(page => page.hidden), [false, true, true, true]);
  fixture.main.scrollTop = 180;
  assert.equal(workspace.navigate('categories'), true);
  dirty = true;
  assert.equal(workspace.navigate('library'), false);
  assert.equal(workspace.current, 'categories');
  assert.deepEqual(fixture.pages.map(page => page.hidden), [true, true, false, true]);
  dirty = false;
  assert.equal(workspace.navigate('choose'), true);
  assert.equal(fixture.main.scrollTop, 180);
  assert.equal(fixture.links[0].attrs['aria-current'], 'page');
  assert.equal(fixture.links[2].attrs['aria-current'], undefined);
  assert.equal(workspace.navigate('invalid'), false);
  assert.deepEqual(changes, ['categories', 'choose']);
});
test('settings tabs support selection, arrow keys and one keyboard tab stop', () => {
  const fixture = fakeDocument();
  const workspace = createWorkspace({ document: fixture.doc });
  workspace.selectTab('display');
  assert.deepEqual(fixture.panels.map(panel => panel.hidden), [true, false, true, true, true]);
  assert.deepEqual(fixture.tabs.map(tab => tab.tabIndex), [-1, 0, -1, -1, -1]);
  let prevented = false;
  fixture.tabs[1].events.keydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fixture.tabs[0].attrs['aria-selected'], 'true');
  assert.equal(fixture.tabs[0].focused, true);
  fixture.tabs[0].events.keydown({ key: 'End', preventDefault() {} });
  assert.equal(fixture.tabs[4].attrs['aria-selected'], 'true');
});
test('workspace labels update when the saved interface language changes', () => {
  const fixture = fakeDocument();
  const workspace = createWorkspace({ document: fixture.doc });
  workspace.navigate('library');
  setLanguage('en');
  assert.equal(fixture.ids['page-title'].textContent, 'Library');
  for (const [ru, en] of [['Выбор игры', 'Choose a game'], ['Папки Steam', 'Steam folders'], ['Карточки', 'Cards'], ['Выбрать из подборки', 'Pick from collection'], ['Мои данные', 'My data'], ['Сбросить фильтры', 'Reset filters']]) assert.equal(translate(ru), en);
  setLanguage('ru');
  assert.equal(fixture.ids['page-title'].textContent, 'Библиотека');
});
test('application markup keeps major tasks as pages and only transient interactions modal', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/desktop.css', import.meta.url), 'utf8');
  for (const page of PAGES) assert.equal((html.match(new RegExp(`data-workspace-page="${page}"`, 'g')) ?? []).length, 1);
  assert.doesNotMatch(app, /\$\('(?:categories|settings)-dialog'\)\.(?:showModal|close)\(/);
  assert.match(app, /workspace.current !== 'choose'/);
  assert.match(app, /resetPreview: false/);
  assert.match(app, /workspace.current !== 'library'/);
  assert.match(app, /if \(options.childElementCount\) return/);
  assert.match(css, /\.app-shell > main[^}]*overflow: auto/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(html, /class="spotlight-media"/);
  assert.match(html, /id="toggle-description"[^>]*aria-controls="description-dialog"/);
  assert.doesNotMatch(html, /class="chooser-library-link"/);
  assert.match(css, /\.spotlight \{ min-height: 560px/);
  assert.match(css, /\.spotlight-media \{ flex: 1 1 0; height: auto/);
  assert.match(css, /\.spotlight-body \{ height: auto; flex: 0 0 auto/);
  assert.match(css, /\.cycle-meta \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.pool-note[^}]*min-height: 36px/);
  assert.doesNotMatch(css, /\.spotlight-body \{ height: (?:432|480|400)px/);
  assert.match(css, /\.card-category-badges[^}]*max-height: none/);
  assert.match(css, /scrollbar-color: transparent transparent/);
  assert.match(html, /id="decision-dialog"[^>]*aria-describedby="decision-message"/);
  assert.match(app, /setExcluded\(id, !state.excluded.includes\(id\)\)/);
  assert.doesNotMatch(app, /confirm\('Отменить несохранённые изменения/);
  assert.match(css, /\.spotlight \{[^}]*overflow: visible/);
  assert.match(css, /\.spotlight-body \{[^}]*background: var\(--surface\)/);
  assert.match(css, /\.spotlight-body p\.hero-context[^}]*font-size: var\(--type-caption\)/);
  assert.match(html, /id="draw-options"[^>]*class="draw-options"/);
  assert.match(css, /\.draw-panel \{ grid-row: 1/);
  assert.match(app, /a,summary,\[role="button"\]/);
  assert.match(app, /if \(heroGameId === id[^\n]*renderHeroDescription\(game\)/);
  assert.doesNotMatch(app, /\$\('hero-description'\)\.textContent = ''/);
  assert.doesNotMatch(css, /\.is-drawing \.hero-actions \{ display: none/);
  assert.match(app, /if \(!game \|\| launching \|\| busy/);
  assert.match(app, /render\(game\) \{ animationGame = game; renderHero\(\); \}/);
  assert.match(app, /const loadingLibrary = !snapshot && !scanFailed/);
  let balance = 0;
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) { if (char === '{') balance++; if (char === '}') balance--; assert.ok(balance >= 0); }
  assert.equal(balance, 0);
});
