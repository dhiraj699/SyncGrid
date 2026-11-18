/**
 * Collects submissions that arrive within one tick window and hands them to
 * `processBatch` together, so the transformation step sees every concurrent
 * edit at once instead of whichever happened to land first.
 */
export class TickSequencer {
  #queue = [];
  #timer = null;

  constructor({ tickMs, processBatch }) {
    this.tickMs = tickMs;
    this.processBatch = processBatch;
  }

  submit(submission) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ submission, resolve, reject });
      this.#timer ??= setTimeout(() => this.#drain(), this.tickMs);
    });
  }

  #drain() {
    this.#timer = null;
    const batch = this.#queue.splice(0);
    try {
      this.processBatch(batch.map((entry) => entry.submission));
      for (const entry of batch) entry.resolve(entry.submission);
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  }
}
