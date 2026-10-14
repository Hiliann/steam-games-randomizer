export function desktopOwnerId(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value ?? ''))) return 0;
  const id = Number(value);
  return id <= 0x7fffffff ? id : 0;
}

// An open native window owns the service, not a fragile renderer connection.
// If Windows kills the window, the service also exits without relying on JS.
export function watchDesktopOwner(owner, {
  isAlive = id => { try { process.kill(id, 0); return true; } catch (error) { return error.code === 'EPERM'; } },
  setTimer = setInterval, clearTimer = clearInterval, onExit = () => {}, intervalMs = 2000,
} = {}) {
  const id = desktopOwnerId(owner);
  if (!id) return () => {};
  let ended = false;
  const timer = setTimer(() => {
    if (ended || isAlive(id)) return;
    ended = true; clearTimer(timer); onExit();
  }, intervalMs);
  timer?.unref?.();
  return () => { ended = true; clearTimer(timer); };
}
