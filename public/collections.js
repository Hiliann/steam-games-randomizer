export function collectionView(games, { query = '', filter = 'all', draft = new Set(), focusId = null, locale = 'ru' } = {}) {
  const selected = draft instanceof Set ? draft : new Set(draft);
  const term = query.trim().toLocaleLowerCase(locale);
  const compare = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare;
  return games.filter(game => game.name.toLocaleLowerCase(locale).includes(term)
    && (filter === 'all' || (filter === 'added') === selected.has(game.id)))
    .sort((left, right) => Number(right.id === focusId) - Number(left.id === focusId)
      || compare(left.name, right.name)
      || String(left.id).localeCompare(String(right.id)));
}

export function collectionChanges(original, draft) {
  return { added: [...draft].filter(id => !original.has(id)).length,
    removed: [...original].filter(id => !draft.has(id)).length, total: draft.size };
}

export function collectionFocusAfterToggle(visible, id, draft, filter = 'all') {
  const remains = game => filter === 'all' || (filter === 'added') === draft.has(game.id);
  const index = visible.findIndex(game => game.id === id);
  if (index < 0) return null;
  if (remains(visible[index])) return id;
  return visible.slice(index + 1).find(remains)?.id
    ?? [...visible.slice(0, index)].reverse().find(remains)?.id ?? null;
}

export function collectionCounts(games, assignments) {
  const counts = new Map();
  for (const game of games) for (const id of new Set(assignments[game.id] ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
