import { tr } from './i18n.js';
import { featureLabel, genreLabel } from './store-details.js';

export const MAX_FILTER_PRESETS = 12;
export const PRESET_DEFAULTS = Object.freeze({ filter: 'included', category: 'all', status: 'all', sort: 'name', query: '', genre: 'all', feature: 'all' });
const FILTERS = ['included', 'all', 'excluded'];
const STATUSES = ['all', 'installed', 'uninstalled'];
const SORTS = ['name', 'recent', 'size'];
const FEATURES = ['all', 'unknown', 'single', 'multi', 'coop'];
const validPresetId = id => typeof id === 'string' && /^preset-[a-f0-9]{12}$/.test(id);
const validCategoryId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(id);

export function cleanPresetName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= 32 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

// Strict: a saved preset is either fully valid or rejected, never partially guessed.
export function cleanPresetFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { filter, category, status, sort, query, genre = 'all', feature = 'all' } = value;
  if (!FILTERS.includes(filter) || !STATUSES.includes(status) || !SORTS.includes(sort)) return null;
  if (category !== 'all' && !validCategoryId(category)) return null;
  if (typeof query !== 'string' || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) return null;
  if (!['all', 'unknown'].includes(genre) && !(typeof genre === 'string' && /^[1-9]\d{0,3}$/.test(genre)) || !FEATURES.includes(feature)) return null;
  return { filter, category, status, sort, query: query.trim(), genre, feature };
}

export function validatePresets(value, categoryIds) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FILTER_PRESETS) throw new Error('Invalid presets');
  const ids = new Set(), names = new Set();
  return value.map(item => {
    const name = cleanPresetName(item?.name);
    const filters = cleanPresetFilters(item?.filters);
    const key = name?.toLocaleLowerCase('ru');
    if (!validPresetId(item?.id) || ids.has(item.id) || !name || names.has(key) || !filters) throw new Error('Invalid preset');
    ids.add(item.id); names.add(key);
    // A preset outlives a deleted category by falling back to all categories.
    if (filters.category !== 'all' && !categoryIds.has(filters.category)) filters.category = 'all';
    return { id: item.id, name, filters };
  });
}

export const sameFilters = (left, right) => Object.keys(PRESET_DEFAULTS).every(key => left[key] === right[key]);
export const isDefaultFilters = filters => sameFilters(filters, PRESET_DEFAULTS);

export function presetNameError(name, presets) {
  const clean = cleanPresetName(name);
  if (!clean) return tr('Название набора должно содержать от 1 до 32 символов.', 'A preset name must have 1 to 32 characters.');
  if (presets.some(item => item.name.toLocaleLowerCase('ru') === clean.toLocaleLowerCase('ru'))) return tr('Набор с таким названием уже есть.', 'A preset with this name already exists.');
  if (presets.length >= MAX_FILTER_PRESETS) return tr(`Можно сохранить не больше ${MAX_FILTER_PRESETS} наборов.`, `You can save up to ${MAX_FILTER_PRESETS} presets.`);
  return null;
}

export function describePreset(filters, categories = [], genreNames = {}) {
  const parts = [];
  if (filters.filter === 'all') parts.push(tr('все игры', 'all games'));
  if (filters.filter === 'excluded') parts.push(tr('исключённые', 'excluded'));
  if (filters.category !== 'all') parts.push(categories.find(item => item.id === filters.category)?.name ?? tr('категория', 'category'));
  if (filters.status === 'installed') parts.push(tr('установленные', 'installed'));
  if (filters.status === 'uninstalled') parts.push(tr('неустановленные', 'not installed'));
  if (filters.genre === 'unknown') parts.push(tr('жанр не загружен', 'genre not loaded'));
  else if (filters.genre !== 'all') parts.push(genreLabel(filters.genre, genreNames));
  if (filters.feature !== 'all') parts.push(featureLabel(filters.feature));
  if (filters.query) parts.push(`«${filters.query}»`);
  if (filters.sort === 'recent') parts.push(tr('по последнему запуску', 'by last played'));
  if (filters.sort === 'size') parts.push(tr('по размеру', 'by size'));
  return parts.join(' · ') || tr('без фильтров', 'no filters');
}

// Renders the preset bar. All persistence goes through the injected callbacks.
export function createFilterPresetsView({ container, element, icon, getPresets, getCategories, getGenreNames = () => ({}), getFilters, isBusy, onApply, onSave, onDelete }) {
  let editing = false, error = '', draftName = '';
  // Grid renders happen on every search keystroke. Keep an open name form
  // intact so typing, focus and the caret are not lost.
  function render() {
    const form = container.querySelector('.filter-preset-form');
    if (editing && form) {
      const busy = isBusy();
      for (const button of container.querySelectorAll('button:not(.filter-preset-cancel)')) button.disabled = busy;
      return;
    }
    rebuild();
  }
  function rebuild() {
    const presets = getPresets(), current = getFilters(), busy = isBusy();
    const nodes = [];
    const label = element('span', 'filter-presets-label', tr('Наборы фильтров', 'Filter presets'));
    label.id = 'filter-presets-label';
    nodes.push(label);
    const list = element('div', 'filter-presets-list');
    list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', label.id);
    for (const preset of presets) {
      const active = sameFilters(preset.filters, current);
      const item = element('span', `filter-preset${active ? ' active' : ''}`);
      const apply = element('button', 'filter-preset-apply', preset.name);
      apply.type = 'button'; apply.disabled = busy;
      apply.setAttribute('aria-pressed', String(active));
      apply.title = describePreset(preset.filters, getCategories(), getGenreNames());
      apply.addEventListener('click', () => onApply(preset));
      const remove = element('button', 'filter-preset-remove');
      remove.type = 'button'; remove.disabled = busy; remove.append(icon('close'));
      remove.setAttribute('aria-label', tr(`Удалить набор ${preset.name}`, `Delete preset ${preset.name}`));
      remove.title = remove.getAttribute('aria-label');
      remove.addEventListener('click', () => onDelete(preset));
      item.append(apply, remove);
      list.append(item);
    }
    nodes.push(list);
    if (editing) {
      const form = element('form', 'filter-preset-form');
      const input = element('input');
      input.type = 'text'; input.maxLength = 32; input.value = draftName; input.autocomplete = 'off';
      input.placeholder = tr('Например, Короткие вечером', 'For example, Short evening games');
      input.setAttribute('aria-label', tr('Название набора фильтров', 'Filter preset name'));
      input.addEventListener('input', () => { draftName = input.value; });
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); } });
      const save = element('button', 'button button-primary', tr('Сохранить', 'Save')); save.type = 'submit'; save.disabled = busy;
      const close = element('button', 'text-button filter-preset-cancel', tr('Отменить', 'Cancel')); close.type = 'button';
      close.addEventListener('click', cancel);
      form.append(input, save, close);
      if (error) { const message = element('p', 'filter-preset-error', error); message.setAttribute('role', 'alert'); form.append(message); }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        error = presetNameError(draftName, getPresets()) ?? '';
        if (error) { rebuild(); container.querySelector('input')?.focus(); return; }
        if (await onSave(cleanPresetName(draftName), { ...getFilters() })) { editing = false; draftName = ''; }
        rebuild();
      });
      nodes.push(form);
      requestAnimationFrame(() => { if (editing && !container.contains(document.activeElement)) input.focus(); });
    } else if (!isDefaultFilters(current) && !presets.some(item => sameFilters(item.filters, current)) && presets.length < MAX_FILTER_PRESETS) {
      const add = element('button', 'text-button filter-preset-add', tr('Сохранить текущие фильтры', 'Save current filters'));
      add.type = 'button'; add.disabled = busy;
      add.addEventListener('click', () => { editing = true; error = ''; rebuild(); });
      nodes.push(add);
    }
    container.replaceChildren(...nodes);
    container.hidden = !presets.length && nodes.length === 2;
  }
  function cancel() { editing = false; error = ''; draftName = ''; rebuild(); }
  return { render, get editing() { return editing; } };
}
