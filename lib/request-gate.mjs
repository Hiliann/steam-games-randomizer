// One rate limit for every Steam Store request made by this process, so
// background genre loading and on-demand lookups never add up to more traffic.
export function createRequestGate({ interval = 2000, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let queue = Promise.resolve(), lastStart = -Infinity, blockedUntil = 0;
  return {
    now, wait,
    blocked: () => now() < blockedUntil,
    remaining: () => Math.max(0, blockedUntil - now()),
    // Steam refusals pause all requests for 30 minutes; other failures for 30 seconds.
    failure(status) {
      if ([403, 429].includes(status)) blockedUntil = now() + 30 * 60000;
      else blockedUntil = Math.max(blockedUntil, now() + 30000);
    },
    turn() {
      const task = queue.then(async () => { await wait(Math.max(0, lastStart + interval - now())); lastStart = now(); });
      queue = task.catch(() => {});
      return task;
    },
  };
}
