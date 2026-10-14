function sessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replaceAll('-', '');
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

export function connectBrowserSession({ windowObject = globalThis.window, WebSocketClass = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout, onState = () => {} } = {}) {
  if (!windowObject || typeof WebSocketClass !== 'function') return () => {};
  const id = sessionId();
  let socket;
  let active = false;
  let retryTimer;
  let attempts = 0;
  let connectedOnce = false;

  const connect = () => {
    if (!active) return;
    onState(connectedOnce ? 'reconnecting' : 'connecting');
    try {
      const protocol = windowObject.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const current = new WebSocketClass(`${protocol}//${windowObject.location.host}/api/browser-session?id=${encodeURIComponent(id)}`);
      socket = current;
      current.onopen = () => {
        if (!active || socket !== current) return;
        const restored = connectedOnce;
        connectedOnce = true; attempts = 0;
        onState('connected', restored);
      };
      current.onclose = () => {
        if (!active || socket !== current) return;
        socket = undefined;
        scheduleRetry();
      };
      current.onerror = () => { /* close handles recovery exactly once */ };
    } catch { socket = undefined; scheduleRetry(); }
  };
  const scheduleRetry = () => {
    if (!active) return;
    onState('reconnecting');
    retryTimer = setTimer(() => { retryTimer = undefined; connect(); }, Math.min(3000, 300 * 2 ** Math.min(attempts++, 4)));
  };

  const start = () => {
    if (active) return;
    active = true;
    connect();
  };

  const stop = () => {
    if (!active) return;
    active = false;
    clearTimer(retryTimer); retryTimer = undefined;
    try { socket?.close(); } catch { /* The browser also closes the socket with the tab. */ }
    socket = undefined;
  };

  windowObject.addEventListener('pagehide', stop);
  windowObject.addEventListener('pageshow', start);
  start();
  return () => {
    stop();
    windowObject.removeEventListener?.('pagehide', stop);
    windowObject.removeEventListener?.('pageshow', start);
  };
}
