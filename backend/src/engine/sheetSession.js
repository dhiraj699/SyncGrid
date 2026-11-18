import { EventEmitter } from 'node:events';
import { permissionMaskFor } from '../domain/access.js';
import { columnKeyOf, parseCellId } from '../domain/cellId.js';
import { toWireCell, projectSheet } from '../security/masking.js';
import { cellStateFromEvent } from './eventLog.js';
import { FormulaEngine } from './formulaEngine.js';
import { PersistenceWorker } from './persistenceWorker.js';
import { TickSequencer } from './sequencer.js';
import { Resolution, compareOrdering, resolveAgainstCell } from './transform.js';
import { normalizeValue } from './validation.js';
import { mergeInto } from './vectorClock.js';

export const OpStatus = Object.freeze({
  APPLIED: 'APPLIED',
  NOOP: 'NOOP',
  SUPERSEDED: 'SUPERSEDED',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
  ROLLED_BACK: 'ROLLED_BACK',
});

export class SheetNotFoundError extends Error {
  constructor(sheetId) {
    super(`Sheet "${sheetId}" does not exist`);
    this.code = 'SHEET_NOT_FOUND';
  }
}

const EMPTY_CELL = Object.freeze({ value: null, revision: 0, lamport: 0, authorId: null, authorRole: null, opId: null, vectorClock: Object.freeze({}) });
const RECENT_OP_WINDOW = 20_000;
const MAX_TRACKED_OP_IDS = 100_000;
const RECOVERY_PAGE_SIZE = 5_000;
const MUTABLE_COLUMN_FIELDS = ['confidential', 'staffEditable'];

const rejected = (opId, reason, message) => ({ opId, status: OpStatus.REJECTED, reason, message });

/**
 * Authoritative in-memory state for one sheet. Mutations enter through
 * `submit`, are batched per tick by the sequencer, ordered deterministically,
 * applied against per-cell causal state, and appended to the event log.
 * Emits `committed` (events) and `schema` (columns changed).
 */
export class SheetSession extends EventEmitter {
  #store;
  #logger;
  #cells = new Map();
  #columns = new Map();
  #seenOpIds = new Map();
  #sequencer;
  #worker;
  #formulaEngine;

  sheet;
  revision = 0;
  lamport = 0;
  vectorClock = {};

  static async open({ sheetId, store, config, logger }) {
    const sheet = await store.getSheet(sheetId);
    if (!sheet) throw new SheetNotFoundError(sheetId);

    const session = new SheetSession({ sheet, store, config, logger });
    const { cellStates, lastEventSeq } = await store.loadSheetState(sheetId);
    for (const doc of cellStates) session.#restoreCell(doc.cellId, doc);

    if (lastEventSeq > session.revision) await session.#recoverTail(session.revision);
    const recent = await store.loadEvents(sheetId, { afterSeq: Math.max(0, session.revision - RECENT_OP_WINDOW), limit: RECENT_OP_WINDOW });
    for (const event of recent) session.#seenOpIds.set(event.opId, event.seq);
    return session;
  }

  constructor({ sheet, store, config, logger }) {
    super();
    this.#store = store;
    this.#logger = logger.child({ sheetId: sheet.id });
    this.#formulaEngine = new FormulaEngine({ columns: sheet.columns, rowCount: sheet.rowCount });
    this.#setSheet(sheet);
    this.#sequencer = new TickSequencer({ tickMs: config.SEQUENCER_TICK_MS, processBatch: (batch) => this.#processTick(batch) });
    this.#worker = new PersistenceWorker({
      sheetId: sheet.id,
      store,
      debounceMs: config.PERSIST_DEBOUNCE_MS,
      maxWaitMs: config.PERSIST_MAX_WAIT_MS,
      logger: this.#logger,
    });
  }

  get columnsByKey() {
    return this.#columns;
  }

  get formulaEngine() {
    return this.#formulaEngine;
  }

  /** Re-applies events that reached the log but whose cell states were never written (crash between bulkWrites). */
  async #recoverTail(fromSeq) {
    let cursor = fromSeq;
    for (;;) {
      const page = await this.#store.loadEvents(this.sheet.id, { afterSeq: cursor, limit: RECOVERY_PAGE_SIZE });
      for (const event of page) this.#restoreCell(event.cellId, cellStateFromEvent(event));
      if (page.length < RECOVERY_PAGE_SIZE) return;
      cursor = page.at(-1).seq;
    }
  }

  #restoreCell(cellId, state) {
    const formula = state.formula ?? (typeof state.value === 'string' && state.value.startsWith('=') ? state.value : null);
    this.#cells.set(cellId, {
      value: state.value ?? null,
      formula,
      revision: state.revision,
      lamport: state.lamport ?? 0,
      authorId: state.authorId ?? null,
      authorRole: state.authorRole ?? null,
      authorName: state.authorName ?? null,
      opId: state.opId ?? null,
      vectorClock: state.vectorClock ?? {},
      timestamp: state.timestamp,
    });
    if (formula) {
      this.#formulaEngine.registerFormula(cellId, formula);
    }
    this.revision = Math.max(this.revision, state.revision);
    this.lamport = Math.max(this.lamport, state.lamport ?? 0);
    mergeInto(this.vectorClock, state.vectorClock ?? {});
  }

  #setSheet(sheet) {
    this.sheet = sheet;
    this.#columns = new Map(sheet.columns.map((column) => [column.key, column]));
    this.#formulaEngine?.updateSchema(sheet.columns, sheet.rowCount);
  }

  /**
   * @param {{ author: { id: string, role: string }, ops: object[], atomic?: boolean }} request
   * @returns {Promise<{ results: object[], revision: number }>}
   */
  async submit({ author, ops, atomic = false }) {
    const submission = { author, ops, atomic, results: new Array(ops.length) };
    await this.#sequencer.submit(submission);
    return { results: submission.results, revision: this.revision };
  }

  #processTick(submissions) {
    const units = submissions.flatMap((submission) => {
      const entries = submission.ops.map((op, index) => ({ op, index }));
      return submission.atomic
        ? [{ submission, entries }]
        : entries.map((entry) => ({ submission, entries: [entry] }));
    });

    units.sort((left, right) => compareOrdering(this.#unitKey(left), this.#unitKey(right)));

    const committed = [];
    for (const unit of units) this.#runUnit(unit, committed);
    if (committed.length === 0) return;

    // Recalculate dependent formula cells in topological order
    const changedCellIds = [...new Set(committed.map((event) => event.cellId))];
    const dependentsToRecalc = this.#formulaEngine.getDependentsToRecalculate(changedCellIds);

    for (const depCellId of dependentsToRecalc) {
      const currentDep = this.#cells.get(depCellId) ?? EMPTY_CELL;
      const nextVal = this.#formulaEngine.evaluate(depCellId, (id) => this.#cells.get(id)?.value ?? null);
      if (currentDep.value !== nextVal) {
        this.revision += 1;
        this.lamport += 1;
        const formulaStr = this.#formulaEngine.getFormula(depCellId);
        const depEvent = {
          sheetId: this.sheet.id,
          seq: this.revision,
          opId: `calc-${this.revision}`,
          cellId: depCellId,
          opType: nextVal === null ? 'CLEAR' : 'SET',
          value: nextVal,
          previousValue: currentDep.value,
          ...(formulaStr ? { formula: formulaStr } : {}),
          authorId: 'system',
          authorRole: 'SYSTEM',
          vectorClock: { ...this.vectorClock },
          lamport: this.lamport,
          clientTimestamp: Date.now(),
          timestamp: Date.now(),
        };
        this.#cells.set(depCellId, {
          ...currentDep,
          value: nextVal,
          formula: formulaStr,
          revision: this.revision,
          lamport: this.lamport,
          authorId: 'system',
          authorRole: 'SYSTEM',
          opId: depEvent.opId,
          timestamp: depEvent.timestamp,
        });
        this.#trackOpId(depEvent.opId, depEvent.seq);
        committed.push(depEvent);
      }
    }

    const dirtyStates = new Map(committed.map((event) => [event.cellId, this.#cells.get(event.cellId)]));
    this.#worker.enqueue({ events: committed, cellStates: dirtyStates });
    this.emit('committed', { events: committed, revision: this.revision });
  }

  #unitKey({ submission, entries }) {
    const { op } = entries[0];
    return { lamport: op.lamport, authorRole: submission.author.role, authorId: submission.author.id, opId: op.opId };
  }

  /** Applies one unit all-or-nothing: an atomic unit that hits a violation is fully unwound. */
  #runUnit({ submission, entries }, committed) {
    const { author, results } = submission;
    const journal = [];
    const unitEvents = [];
    const revisionBefore = this.revision;
    let failure = null;

    for (const entry of entries) {
      let outcome;
      try {
        outcome = this.#applyEntry(entry.op, author, journal, unitEvents);
      } catch (error) {
        this.#logger.error({ err: error, opId: entry.op.opId }, 'mutation crashed during apply');
        outcome = rejected(entry.op.opId, 'INTERNAL_ERROR', 'Mutation could not be processed');
      }
      results[entry.index] = outcome;
      if (outcome.status === OpStatus.REJECTED && submission.atomic) {
        failure = outcome;
        break;
      }
    }

    if (failure) {
      this.#rollback(journal, revisionBefore);
      for (const entry of entries) {
        if (results[entry.index] !== failure) {
          results[entry.index] = { opId: entry.op.opId, status: OpStatus.ROLLED_BACK, reason: failure.reason, message: failure.message };
        }
      }
      return;
    }

    for (const event of unitEvents) {
      mergeInto(this.vectorClock, event.vectorClock);
      this.lamport = Math.max(this.lamport, event.lamport);
      committed.push(event);
    }
  }

  #applyEntry(op, author, journal, unitEvents) {
    if (this.#seenOpIds.has(op.opId)) return { opId: op.opId, status: OpStatus.DUPLICATE };

    const target = parseCellId(op.cellId);
    const column = target && this.#columns.get(target.columnKey);
    if (!column || target.rowIndex >= this.sheet.rowCount) {
      return rejected(op.opId, 'UNKNOWN_CELL', 'Cell is outside the sheet');
    }
    if (!permissionMaskFor(author.role, column).canWrite) {
      return rejected(op.opId, 'FORBIDDEN', `${author.role} cannot edit ${column.label}`);
    }

    const normalized = normalizeValue(column, op.opType === 'CLEAR' ? null : op.value);
    if (!normalized.ok) return rejected(op.opId, 'SCHEMA_VIOLATION', normalized.message);

    const current = this.#cells.get(op.cellId) ?? EMPTY_CELL;
    const incoming = { vectorClock: op.vectorClock, lamport: op.lamport, authorRole: author.role, authorId: author.id, opId: op.opId };
    if (resolveAgainstCell(current, incoming) === Resolution.SUPERSEDED) {
      return { opId: op.opId, status: OpStatus.SUPERSEDED, seq: current.revision };
    }

    const isFormula = typeof normalized.value === 'string' && normalized.value.startsWith('=');
    let effectiveValue = normalized.value;
    let formulaStr = null;

    if (isFormula) {
      formulaStr = normalized.value;
      this.#formulaEngine.registerFormula(op.cellId, formulaStr);
      effectiveValue = this.#formulaEngine.evaluate(op.cellId, (id) => this.#cells.get(id)?.value ?? null);
    } else {
      if (this.#formulaEngine.hasFormula(op.cellId)) {
        this.#formulaEngine.clearFormula(op.cellId);
      }
    }

    if (current.value === effectiveValue && (current.formula ?? null) === formulaStr) {
      return { opId: op.opId, status: OpStatus.NOOP };
    }

    const event = {
      sheetId: this.sheet.id,
      seq: this.revision + 1,
      opId: op.opId,
      cellId: op.cellId,
      opType: normalized.value === null ? 'CLEAR' : 'SET',
      value: effectiveValue,
      previousValue: current.value,
      ...(formulaStr ? { formula: formulaStr } : {}),
      authorId: author.id,
      authorRole: author.role,
      authorName: author.name,
      vectorClock: op.vectorClock,
      lamport: op.lamport,
      clientTimestamp: op.clientTimestamp,
      timestamp: Date.now(),
    };

    journal.push({ cellId: op.cellId, previous: this.#cells.get(op.cellId), opId: op.opId });
    this.revision = event.seq;
    this.#cells.set(op.cellId, {
      ...cellStateFromEvent(event),
      formula: formulaStr,
      authorName: author.name,
      timestamp: event.timestamp,
    });
    this.#trackOpId(op.opId, event.seq);
    unitEvents.push(event);
    return { opId: op.opId, status: OpStatus.APPLIED, seq: event.seq };
  }

  #rollback(journal, revisionBefore) {
    for (let index = journal.length - 1; index >= 0; index -= 1) {
      const { cellId, previous, opId } = journal[index];
      if (previous) {
        this.#cells.set(cellId, previous);
        if (previous.formula) {
          this.#formulaEngine.registerFormula(cellId, previous.formula);
        } else {
          this.#formulaEngine.clearFormula(cellId);
        }
      } else {
        this.#cells.delete(cellId);
        this.#formulaEngine.clearFormula(cellId);
      }
      this.#seenOpIds.delete(opId);
    }
    this.revision = revisionBefore;
  }

  #trackOpId(opId, seq) {
    this.#seenOpIds.set(opId, seq);
    if (this.#seenOpIds.size > MAX_TRACKED_OP_IDS) {
      this.#seenOpIds.delete(this.#seenOpIds.keys().next().value);
    }
  }

  /** Role-projected view of the whole sheet; confidential values never leave this method unmasked for restricted roles. */
  snapshot(role) {
    const cells = {};
    for (const [cellId, state] of this.#cells) {
      if (state.value === null) continue;
      const column = this.#columns.get(columnKeyOf(cellId));
      if (column) cells[cellId] = toWireCell(state, permissionMaskFor(role, column));
    }
    return {
      sheet: projectSheet(this.sheet, role),
      cells,
      revision: this.revision,
      vectorClock: { ...this.vectorClock },
      lamport: this.lamport,
    };
  }

  async eventsAfter(afterSeq, limit) {
    await this.flush();
    return this.#store.loadEvents(this.sheet.id, { afterSeq, limit });
  }

  async updateColumn(columnKey, patch) {
    const column = this.#columns.get(columnKey);
    if (!column) return null;
    const next = { ...column };
    for (const field of MUTABLE_COLUMN_FIELDS) if (typeof patch[field] === 'boolean') next[field] = patch[field];

    const sheet = { ...this.sheet, columns: this.sheet.columns.map((existing) => (existing.key === columnKey ? next : existing)) };
    await this.#store.saveSheet(sheet);
    this.#setSheet(sheet);
    this.emit('schema', { columnKey });
    return next;
  }

  flush() {
    return this.#worker.flush();
  }

  close() {
    return this.#worker.close();
  }
}

