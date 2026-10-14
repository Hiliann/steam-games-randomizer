export function createStartupScreen({ node, status, content, skip, schedule = setTimeout }) {
  let finished = false;
  content.inert = true;
  content.setAttribute('aria-busy', 'true');
  function finish() {
    if (finished) return;
    finished = true;
    content.inert = false;
    content.setAttribute('aria-busy', 'false');
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    node.classList.add('is-leaving');
    const hide = () => { node.hidden = true; };
    node.addEventListener('transitionend', event => { if (event.target === node) hide(); });
    schedule(hide, 380); // Only the visual fade remains; the app is usable now.
  }
  skip.addEventListener('click', finish);
  return { stage(message) { if (!finished) status.textContent = message; }, finish };
}
