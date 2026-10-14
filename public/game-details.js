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

export function descriptionLineCount(height, lineHeight) {
  return Math.max(1, Math.floor(height / (Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 22.4)));
}

export function createDescriptionDisclosure({ description, space = description, button, dialog, fullDescription, title, dialogTitle, closeButton, schedule = requestAnimationFrame, style = getComputedStyle }) {
  let key;
  let queued = false;
  function measure() {
    queued = false;
    if (!space.getClientRects().length) return;
    const limit = parseInt(style(space).getPropertyValue?.('--description-max-lines'), 10);
    const lines = Number.isFinite(limit) ? Math.max(1, Math.min(8, limit)) : descriptionLineCount(space.clientHeight, parseFloat(style(description).lineHeight));
    description.style.setProperty('--description-lines', String(lines));
    button.hidden = !description.textContent || description.scrollHeight <= description.clientHeight + 1;
  }
  function refresh(nextKey = key) {
    if (nextKey !== key) { if (dialog.open) dialog.close(); button.hidden = true; }
    key = nextKey;
    button.textContent = tr('Подробнее об игре', 'Read more');
    if (dialog.open) { fullDescription.textContent = description.textContent; dialogTitle.textContent = title.textContent; }
    if (!queued) { queued = true; schedule(measure); }
  }
  button.addEventListener('click', () => {
    if (button.disabled) return;
    fullDescription.textContent = description.textContent;
    dialogTitle.textContent = title.textContent;
    if (!dialog.open) { dialog.showModal(); closeButton.focus(); }
  });
  closeButton.addEventListener('click', () => dialog.close());
  return { refresh };
}
