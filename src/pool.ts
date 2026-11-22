// Şevval Boyraz, 2200004208
// Bonus 6 (option B): a small connection pool of my own.
import { createDb, type Db } from "./db.ts";

/** Lend items one at a time; whoever asks while all are busy waits in a queue. */
export class Pool<T> {
  #idle: T[];
  #waiting: ((item: T) => void)[] = [];
  readonly size: number;

  constructor(items: T[]) {
    if (items.length === 0) throw new Error("a pool needs at least one item");
    this.#idle = [...items];
    this.size = items.length;
  }

  /** An idle item now, or a promise that resolves when one is released. */
  acquire(): Promise<T> {
    const item = this.#idle.pop();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  release(item: T) {
    const next = this.#waiting.shift();
    if (next) next(item); // hand it straight to the one who waited longest
    else this.#idle.push(item);
  }

  /** Borrow an item for fn, and always give it back, even when fn throws. */
  async use<R>(fn: (item: T) => Promise<R>): Promise<R> {
    const item = await this.acquire();
    try {
      return await fn(item);
    } finally {
      this.release(item);
    }
  }

  /** How many callers are waiting right now. */
  get waiting(): number {
    return this.#waiting.length;
  }
}

/**
 * Open `size` libSQL connections on the same SQLite file.
 * WAL: readers do not block the writer. busy_timeout: wait up to 5 s for a lock
 * instead of failing at once with SQLITE_BUSY.
 */
export async function createDbPool(
  url: string,
  size: number,
  authToken?: string,
): Promise<Pool<Db>> {
  const dbs: Db[] = [];
  for (let i = 0; i < size; i++) {
    const db = createDb(url, undefined, authToken);
    if (url.startsWith("file:")) {
      // Only for a local file; a hosted database manages its own locking.
      await db.client.execute("PRAGMA journal_mode = WAL");
      await db.client.execute("PRAGMA busy_timeout = 5000");
    }
    dbs.push(db);
  }
  return new Pool(dbs);
}
