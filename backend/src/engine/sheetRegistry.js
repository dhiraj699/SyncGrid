import { SheetSession } from './sheetSession.js';

export class SheetRegistry {
  #sessions = new Map();

  constructor({ store, config, logger }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
  }

  get(sheetId) {
    if (!this.#sessions.has(sheetId)) {
      const opening = SheetSession.open({ sheetId, store: this.store, config: this.config, logger: this.logger });
      opening.catch(() => this.#sessions.delete(sheetId));
      this.#sessions.set(sheetId, opening);
    }
    return this.#sessions.get(sheetId);
  }

  async closeAll() {
    const sessions = await Promise.allSettled(this.#sessions.values());
    await Promise.allSettled(sessions.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value.close()));
  }
}
