// One transient notification, with an optional action. Pausing while hovered or
// focused keeps Undo usable for keyboard users and longer game names.
export function createToast({ document: doc = document, node, schedule = setTimeout, cancel = clearTimeout, onError = () => {} }) {
  let timer;
  let generation = 0;
  let pending = false;
  let duration = 4000;
  const dismiss = () => { cancel(timer); generation++; pending = false; node.hidden = true; };
  const pause = () => cancel(timer);
  const resume = () => {
    cancel(timer);
    if (!node.hidden && !pending && !node.contains(doc.activeElement) && !node.matches(':hover')) timer = schedule(dismiss, duration);
  };
  node.addEventListener('pointerenter', pause);
  node.addEventListener('pointerleave', resume);
  node.addEventListener('focusin', pause);
  node.addEventListener('focusout', resume);
  function show(message, action) {
    cancel(timer);
    const current = ++generation;
    pending = false;
    duration = action ? 10000 : 4000;
    const copy = doc.createElement('span');
    copy.className = 'toast-message'; copy.textContent = message;
    node.replaceChildren(copy);
    if (action) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'toast-action'; button.textContent = action.label;
      button.addEventListener('click', async () => {
        if (pending || generation !== current) return;
        pause(); pending = true; button.disabled = true;
        try {
          const result = await action.run();
          if (generation !== current) return;
          if (result !== false) dismiss();
        } catch (error) {
          if (generation === current) onError(error);
        } finally {
          if (generation === current) { pending = false; button.disabled = false; resume(); }
        }
      });
      node.append(button);
    }
    node.hidden = false;
    resume();
  }
  return { show, dismiss };
}
