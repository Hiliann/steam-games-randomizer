export const SCROLL_SURFACES = '.app-shell > main, .app-sidebar, .history-list, .category-game-list, .hero-category-options, .library-category-options, .hero-category-strip, dialog';

// Keep the native scrollbar and a stable gutter. Only its color changes, so
// mouse dragging, touch and keyboard scrolling remain browser-managed.
export function createScrollActivity({ root = document, schedule = setTimeout, cancel = clearTimeout, delay = 1100 } = {}) {
  const timers = new Map();
  function onScroll(event) {
    const node = event.target;
    if (!node?.matches?.(SCROLL_SURFACES)) return;
    cancel(timers.get(node));
    node.classList.add('is-scrolling');
    timers.set(node, schedule(() => { node.classList.remove('is-scrolling'); timers.delete(node); }, delay));
  }
  root.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return { dispose() {
    root.removeEventListener('scroll', onScroll, true);
    for (const [node, timer] of timers) { cancel(timer); node.classList.remove('is-scrolling'); }
    timers.clear();
  } };
}
