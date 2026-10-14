import { tr } from './i18n.js';

export function participationDetails(excluded) {
  return excluded ? {
    state: 'excluded', icon: 'close', label: tr('Не участвует в выборе', 'Excluded from picks'),
    action: tr('Вернуть в выбор', 'Include in picks'),
  } : {
    state: 'included', icon: 'check', label: tr('Участвует в выборе', 'Included in picks'),
    action: tr('Исключить из выбора', 'Exclude from picks'),
  };
}

export function createDescriptionDisclosure({ description, button, schedule = requestAnimationFrame }) {
  let key;
  let expanded = false;
  let queued = false;
  function measure() {
    queued = false;
    if (!description.getClientRects().length) return;
    button.hidden = !expanded && description.scrollHeight <= description.clientHeight + 1;
  }
  function refresh(nextKey = key) {
    if (nextKey !== key) { key = nextKey; expanded = false; }
    description.classList.toggle('description-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? tr('Свернуть описание', 'Show less') : tr('Подробнее об игре', 'Read more');
    if (!queued) { queued = true; schedule(measure); }
  }
  button.addEventListener('click', () => { expanded = !expanded; refresh(); });
  return { refresh, get expanded() { return expanded; } };
}
