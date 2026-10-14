import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectionView, collectionChanges, collectionFocusAfterToggle, collectionCounts } from '../public/collections.js';
import { setLanguage, translate } from '../public/i18n.js';

const games = [{ id:'1', name:'Game 10' }, { id:'2', name:'Game 2' }, { id:'3', name:'Другой мир' }];
test('collection search combines membership and title without mutating games or the draft', () => {
  const draft = new Set(['1', '3']); const before = structuredClone(games);
  assert.deepEqual(collectionView(games, { query:'  GAME ', draft }).map(g=>g.id), ['2','1']);
  assert.deepEqual(collectionView(games, { filter:'added', query:'game', draft }).map(g=>g.id), ['1']);
  assert.deepEqual(collectionView(games, { filter:'missing', draft }).map(g=>g.id), ['2']);
  assert.deepEqual(collectionView(games, { query:'ДРУГОЙ', draft }).map(g=>g.id), ['3']);
  assert.deepEqual(games, before); assert.deepEqual([...draft], ['1','3']);
});
test('a requested game is pinned only if it matches the current search and membership filter', () => {
  assert.equal(collectionView(games, { focusId:'1', locale:'en' })[0].id, '1');
  assert.deepEqual(collectionView(games, { focusId:'1', query:'Game 2' }).map(g=>g.id), ['2']);
  assert.deepEqual(collectionView(games, { focusId:'1', filter:'added', draft:['2'] }).map(g=>g.id), ['2']);
});
test('collection changes distinguish additions and removals, including unavailable game IDs', () => {
  const original=new Set(['1','900']), draft=new Set(['2','900']);
  assert.deepEqual(collectionChanges(original,draft), {added:1,removed:1,total:2});
  assert.deepEqual(collectionChanges(original,original), {added:0,removed:0,total:2});
});
test('filtered checkbox edits move focus to the next surviving game or the previous one', () => {
  assert.equal(collectionFocusAfterToggle(games,'1',new Set(['1']),'missing'),'2');
  assert.equal(collectionFocusAfterToggle(games,'3',new Set(['3']),'missing'),'2');
  assert.equal(collectionFocusAfterToggle(games,'1',new Set(['2','3']),'added'),'2');
  assert.equal(collectionFocusAfterToggle([games[0]],'1',new Set(),'added'),null);
  assert.equal(collectionFocusAfterToggle(games,'unknown',new Set(),'all'),null);
});
test('unfiltered edits keep focus on the same checkbox and do not jump between games', () => {
  assert.equal(collectionFocusAfterToggle(games,'2',new Set(['2']),'all'),'2');
  assert.equal(collectionFocusAfterToggle(games,'2',new Set(),'all'),'2');
});
test('collection save and failure messages are localized', () => {
  setLanguage('en');
  assert.equal(translate('Сохраняем изменения…'), 'Saving changes…');
  assert.equal(translate('Подборка сохранена'), 'Collection saved');
  assert.equal(translate('Категории недоступны. Нажми «Обновить список» в библиотеке.'), 'Categories are unavailable. Click “Refresh list” in the library.');
  setLanguage('ru');
});
test('category counts visit visible games once and do not count duplicate memberships', () => {
  const assignments={'1':['a','a','b'],'2':['b'],'999':['a']};
  assert.deepEqual([...collectionCounts(games,assignments)], [['a',1],['b',2]]);
  assert.deepEqual(assignments, {'1':['a','a','b'],'2':['b'],'999':['a']});
});
test('category editor exposes scoped search, safe counts and narrow-window headings', async () => {
  const file=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
  const html=await file('public/index.html'), app=await file('public/app.js'), css=await file('public/desktop.css');
  for(const id of ['category-clear-search','category-reset-filters','category-visible-count']) assert.match(html,new RegExp(`id="${id}"`));
  assert.doesNotMatch(html,/id="category-game-list"[^>]*aria-live/);
  assert.match(app,/categoryGameFilter === 'all'\) renderCategoryDraftSummary\(visible\)/);
  assert.match(app,/workspace.current === 'categories'\) \{ event.preventDefault\(\); \$\('category-search'\).focus\(\)/);
  assert.match(app,/if \(gameId\) resetCategoryFilters\(\)/);
  assert.match(app,/function renderCategoriesDialog\(\) \{[\s\S]*?if \(workspace && workspace.current !== 'categories'\) return;/);
  assert.match(css,/\.category-editor-heading h3[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
  assert.match(css,/\.category-search \{ flex: 0 0 auto; height: 44px/);
  assert.match(css,/\.search-box input:focus-visible \{ outline: none; \}/);
  assert.match(css,/\.search-box:focus-within \{ outline: 2px solid var\(--accent\)/);
});
