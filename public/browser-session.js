function sessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function connectBrowserSession({ windowObject = globalThis.window, WebSocketClass = globalThis.WebSocket } = {}) {
  if (!windowObject || typeof WebSocketClass !== 'function') return () => {};
  const id = sessionId();
  let socket;
  let active = false;

  const start = () => {
    if (active) return;
    active = true;
    try {
      const protocol = windowObject.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocketClass(`${protocol}//${windowObject.location.host}/api/browser-session?id=${encodeURIComponent(id)}`);
    } catch { socket = undefined; }
  };

  const stop = () => {
    if (!active) return;
    active = false;
    try { socket?.close(); } catch { /* The browser also closes the socket with the tab. */ }
    socket = undefined;
  };

  windowObject.addEventListener('pagehide', stop);
  windowObject.addEventListener('pageshow', start);
  start();
  return stop;
}
