import { tr } from './i18n.js';

// Card/list markup is independent from scanning, persistence and draw state.
export function renderLibraryCards({ $, element, icon, artwork, renderCardSize, renderCategoryBadges, libraryCategoryMenu, onPreview, onExcluded }, { visible, excluded, busy, scanning, savingExclusion, exclusionsReady }) {
  const fragment = document.createDocumentFragment();
  for (const game of visible) {
    const isExcluded = excluded.has(game.id);
    const card = element('article', 'game-card' + (isExcluded ? ' excluded' : ''));
    const art = element('button', 'game-art');
    art.type = 'button';
    art.setAttribute('aria-label', tr(`Открыть игру: ${game.name}`, `Open game: ${game.name}`));
    art.disabled = busy || scanning;
    art.addEventListener('click', () => { onPreview(game.id); });
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
      await onExcluded(game.id, !checkbox.checked);
      // Restore a useful keyboard target after rebuilding the filtered list.
      const target = document.getElementById(`toggle-${game.id}`) ?? document.getElementById(`toggle-${nextId}`);
      target?.focus({ preventScroll: true });
    });
    checkbox.id = `toggle-${game.id}`;
    toggle.append(checkbox, element('span', '', isExcluded ? 'Исключена' : 'Участвует'));
    const categoryRow = element('div', 'card-category-row');
    const badges = element('div', 'category-badges card-category-badges');
    renderCategoryBadges(badges, game.id);
    categoryRow.append(badges, libraryCategoryMenu(game));
    card.append(art, title, meta, categoryRow, toggle);
    fragment.append(card);
  }
  $('game-grid').replaceChildren(fragment);
}
