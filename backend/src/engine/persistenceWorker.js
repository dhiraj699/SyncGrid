const MAX_BACKOFF_MS = 30_000;

/**
 * Coalesces committed events and dirty cell states and writes them with
 * bulkWrite once the sheet has been quiet for `debounceMs`. `maxWaitMs` bounds
 * how long a continuously edited sheet can postpone a flush.
 */
export class PersistenceWorker {
  #events = [];
  #cellStates = new Map();
  #timer = null;
  #firstQueuedAt = 0;
  #failures = 0;
  #chain = Promise.resolve();
  #closed = false;

  constructor({ sheetId, store, debounceMs, maxWaitMs, logger }) {
    this.sheetId = sheetId;
    this.store = store;
    this.debounceMs = debounceMs;
    this.maxWaitMs = maxWaitMs;
    this.logger = logger;
  }

  get pendingCount() {
    return this.#events.length;
  }

  enqueue({ events, cellStates }) {
    if (this.#closed) throw new Error('PersistenceWorker is closed');
    if (this.#events.length === 0) this.#firstQueuedAt = Date.now();
    this.#events.push(...events);
    for (const [cellId, state] of cellStates) this.#cellStates.set(cellId, state);
    this.#schedule(this.debounceMs);
  }

  flush() {
    this.#clearTimer();
    this.#chain = this.#chain.then(() => this.#writeBatch());
    return this.#chain;
  }

  async close() {
    this.#closed = true;
    await this.flush();
  }

  #schedule(delayMs) {
    this.#clearTimer();
    const remainingBudget = Math.max(0, this.maxWaitMs - (Date.now() - this.#firstQueuedAt));
    this.#timer = setTimeout(() => void this.flush(), Math.min(delayMs, remainingBudget));
    this.#timer.unref?.();
  }

  #clearTimer() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #writeBatch() {
    if (this.#events.length === 0 && this.#cellStates.size === 0) return;

    const events = this.#events;
    const cellStates = this.#cellStates;
    this.#events = [];
    this.#cellStates = new Map();

    try {
      await this.store.bulkPersist({
        sheetId: this.sheetId,
        events,
        cellStates: Array.from(cellStates, ([cellId, state]) => ({ cellId, ...state })),
      });
      this.#failures = 0;
    } catch (error) {
      this.#failures += 1;
      this.#events = [...events, ...this.#events];
      for (const [cellId, state] of cellStates) {
        if (!this.#cellStates.has(cellId)) this.#cellStates.set(cellId, state);
      }
      const backoffMs = Math.min(MAX_BACKOFF_MS, this.debounceMs * 2 ** this.#failures);
      this.logger.error({ err: error, sheetId: this.sheetId, attempt: this.#failures, backoffMs }, 'bulk persistence failed; batch requeued');
      if (!this.#closed) this.#schedule(backoffMs);
    }
  }
}
