import { tr } from './i18n.js';

// The requested continuation runs only after the user explicitly saves or
// discards. Failed writes leave both the dialog and the current draft intact.
export function createDecisionDialog({ dialog, title, message, status, save, discard, cancel }) {
  let current;
  let pending = false;
  const buttons = [save, discard, cancel];
  const close = () => { current = undefined; dialog.close(); };
  const cancelDecision = () => { if (!pending) { const decision = current; close(); decision?.onCancel?.(); } };
  cancel.addEventListener('click', cancelDecision);
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancelDecision(); });
  dialog.addEventListener('close', () => { if (!dialog.open) current = undefined; });
  async function resolve(choice) {
    if (!current || pending) return;
    const decision = current;
    const operation = choice === 'save' ? decision.onSave : decision.onDiscard;
    if (!operation) return;
    pending = true;
    buttons.forEach(button => { button.disabled = true; });
    status.hidden = false;
    status.textContent = decision.pendingMessage ?? tr('Сохраняем изменения…', 'Saving changes…');
    try {
      const saved = await operation();
      if (saved === false) {
        status.textContent = tr('Не удалось подтвердить сохранение. Изменения оставлены на экране. Проверь связь с приложением.', 'Could not confirm the save. Your changes remain on screen. Check the app connection.');
        return;
      }
      close();
      pending = false;
      buttons.forEach(button => { button.disabled = false; });
      decision.proceed?.();
    } catch (error) { status.textContent = error.message; }
    finally { pending = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  save.addEventListener('click', () => resolve('save'));
  discard.addEventListener('click', () => resolve('discard'));
  function request(decision) {
    if (dialog.open || pending) return false;
    current = decision;
    title.textContent = decision.title;
    message.textContent = decision.message;
    status.hidden = true;
    save.hidden = !decision.onSave;
    save.textContent = decision.saveLabel ?? tr('Сохранить и продолжить', 'Save and continue');
    discard.textContent = decision.discardLabel ?? tr('Не сохранять', 'Discard changes');
    cancel.textContent = decision.cancelLabel ?? tr('Остаться', 'Stay here');
    discard.classList.toggle('button-danger', !!decision.danger);
    dialog.showModal();
    cancel.focus();
    return true;
  }
  return { request };
}
