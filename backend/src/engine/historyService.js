import { permissionMaskFor } from '../domain/access.js';
import { columnKeyOf } from '../domain/cellId.js';
import { projectEvent, toWireCell } from '../security/masking.js';
import { foldEvents } from './eventLog.js';

const FOLD_PAGE_SIZE = 10_000;

/** Read model over the immutable event log: replay baselines and event pages, always role-projected. */
export class HistoryService {
  #baselines = new Map();

  constructor({ store, registry }) {
    this.store = store;
    this.registry = registry;
  }

  async #foldBaseline(session) {
    const { id, baselineSeq } = session.sheet;
    if (!this.#baselines.has(id)) {
      const cells = new Map();
      let cursor = 0;
      while (cursor < baselineSeq) {
        const page = await this.store.loadEvents(id, { afterSeq: cursor, untilSeq: baselineSeq, limit: FOLD_PAGE_SIZE });
        if (page.length === 0) break;
        foldEvents(page, cells);
        cursor = page.at(-1).seq;
      }
      this.#baselines.set(id, cells);
    }
    return this.#baselines.get(id);
  }

  async baseline(sheetId, role) {
    const session = await this.registry.get(sheetId);
    const folded = await this.#foldBaseline(session);
    const cells = {};
    for (const [cellId, state] of folded) {
      const column = session.columnsByKey.get(columnKeyOf(cellId));
      if (column && state.value !== null) cells[cellId] = toWireCell(state.value, permissionMaskFor(role, column));
    }
    return { baselineSeq: session.sheet.baselineSeq, cells };
  }

  async events(sheetId, role, { afterSeq, limit }) {
    const session = await this.registry.get(sheetId);
    const page = await session.eventsAfter(afterSeq, limit + 1);
    const events = page.slice(0, limit).map((event) => projectEvent(event, session.columnsByKey, role));
    return { events, hasMore: page.length > limit, revision: session.revision };
  }
}
