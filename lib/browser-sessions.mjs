export const BROWSER_SESSION_DEFAULTS = Object.freeze({ shutdownDelayMs: 4000 });

export function validBrowserSessionId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
}

export function createBrowserSessions({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  shutdownDelayMs = BROWSER_SESSION_DEFAULTS.shutdownDelayMs,
  onEmpty = () => {},
} = {}) {
  const sessions = new Set();
  let connected = false;
  let shutdownTimer;
  let disposed = false;

  const cancelShutdown = () => {
    if (shutdownTimer !== undefined) clearTimer(shutdownTimer);
    shutdownTimer = undefined;
  };

  const scheduleShutdown = () => {
    cancelShutdown();
    if (disposed || !connected || sessions.size) return;
    shutdownTimer = setTimer(() => {
      shutdownTimer = undefined;
      if (!disposed && connected && sessions.size === 0) onEmpty();
    }, shutdownDelayMs);
    shutdownTimer?.unref?.();
  };

  return {
    open() {
      if (disposed) return () => {};
      connected = true;
      const connection = Symbol('browser-session');
      sessions.add(connection);
      cancelShutdown();
      let closed = false;
      return () => {
        if (closed || disposed) return;
        closed = true;
        sessions.delete(connection);
        scheduleShutdown();
      };
    },
    get size() { return sessions.size; },
    dispose() {
      disposed = true;
      sessions.clear();
      cancelShutdown();
    },
  };
}
