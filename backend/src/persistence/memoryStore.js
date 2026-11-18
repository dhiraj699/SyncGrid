/** Process-local store implementing the same contract as MongoStore. Used by tests and `STORE_DRIVER=memory`. */
export class MemoryStore {
  #users = new Map();
  #sheets = new Map();
  #events = new Map();
  #cellStates = new Map();
  persistCalls = 0;

  async connect() {}
  async disconnect() {}

  async upsertUsers(users) {
    for (const user of users) this.#users.set(user.id, structuredClone(user));
  }
  async findUserById(id) {
    return structuredClone(this.#users.get(id) ?? null);
  }
  async findUserByEmail(email) {
    const match = [...this.#users.values()].find((user) => user.email === email);
    return structuredClone(match ?? null);
  }
  async listUsers() {
    return structuredClone([...this.#users.values()]);
  }

  async getSheet(sheetId) {
    return structuredClone(this.#sheets.get(sheetId) ?? null);
  }
  async saveSheet(sheet) {
    this.#sheets.set(sheet.id, structuredClone(sheet));
  }
  async listSheets() {
    return [...this.#sheets.values()].map(({ id, name, rowCount, columns }) => ({ id, name, rowCount, columnCount: columns.length }));
  }
  async clearSheet(sheetId) {
    this.#sheets.delete(sheetId);
    this.#events.delete(sheetId);
    this.#cellStates.delete(sheetId);
  }

  async loadSheetState(sheetId) {
    const states = [...(this.#cellStates.get(sheetId)?.values() ?? [])];
    const events = this.#events.get(sheetId) ?? [];
    return { cellStates: structuredClone(states), lastEventSeq: events.at(-1)?.seq ?? 0 };
  }

  async loadEvents(sheetId, { afterSeq = 0, untilSeq = Infinity, limit = 5000 } = {}) {
    const events = this.#events.get(sheetId) ?? [];
    return structuredClone(events.filter((event) => event.seq > afterSeq && event.seq <= untilSeq).slice(0, limit));
  }

  async bulkPersist({ sheetId, events, cellStates }) {
    this.persistCalls += 1;
    const log = this.#events.get(sheetId) ?? [];
    const knownOpIds = new Set(log.map((event) => event.opId));
    for (const event of structuredClone(events)) if (!knownOpIds.has(event.opId)) log.push(event);
    log.sort((left, right) => left.seq - right.seq);
    this.#events.set(sheetId, log);

    const states = this.#cellStates.get(sheetId) ?? new Map();
    for (const { cellId, ...state } of structuredClone(cellStates)) states.set(cellId, { cellId, ...state });
    this.#cellStates.set(sheetId, states);
  }
}
