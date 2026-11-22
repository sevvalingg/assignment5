// Şevval Boyraz, 2200004208
// Bonus 15
// The Map lives in memory, inside one createApp() call: every test gets its own.

type Entry = { failures: number; resetAt: number };

export function createLoginLimiter(
  { max, windowMs } = { max: 5, windowMs: 60_000 },
  now: () => number = Date.now,
) {
  const entries = new Map<string, Entry>();

  /** 0 when a login may be tried, otherwise the seconds until the window ends. */
  function retryAfterSeconds(key: string): number {
    const e = entries.get(key);
    if (!e || e.resetAt <= now()) return 0;
    if (e.failures < max) return 0;
    return Math.ceil((e.resetAt - now()) / 1000);
  }

  function recordFailure(key: string) {
    const e = entries.get(key);
    if (!e || e.resetAt <= now()) {
      entries.set(key, { failures: 1, resetAt: now() + windowMs });
    } else {
      e.failures++;
    }
  }

  function reset(key: string) {
    entries.delete(key);
  }

  return { retryAfterSeconds, recordFailure, reset };
}
