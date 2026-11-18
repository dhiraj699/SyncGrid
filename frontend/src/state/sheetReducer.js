import { coordinateOf } from '../domain/cellId.js';

const HISTORY_LIMIT = 200;
let noticeSequence = 0;

export const createInitialState = () => ({
  phase: 'loading',
  sheet: null,
  cells: {},
  revision: 0,
  snapshotLoaded: false,
  needsResync: false,
  eventBuffer: [],
  pending: { byId: {}, order: [] },
  overlay: {},
  presence: {},
  history: { undo: [], redo: [] },
  notices: [],
});

export const displayCell = (state, cellId) => state.overlay[cellId] ?? state.cells[cellId];
export const displayValue = (state, cellId) => displayCell(state, cellId)?.value ?? null;
export const pendingCount = (state) => state.pending.order.length;

const buildOverlay = ({ byId, order }) => {
  const overlay = {};
  for (const opId of order) {
    const { op } = byId[opId];
    overlay[op.cellId] = { value: op.value, isMasked: false, locked: false, pending: true };
  }
  return overlay;
};

const withPending = (state, pending) => ({ ...state, pending, overlay: buildOverlay(pending) });

function removePending(pending, opIds) {
  const doomed = new Set(opIds.filter((opId) => pending.byId[opId]));
  if (doomed.size === 0) return pending;
  const byId = { ...pending.byId };
  for (const opId of doomed) delete byId[opId];
  return { byId, order: pending.order.filter((opId) => !doomed.has(opId)) };
}

/** Applies server events strictly in sequence; a gap means we missed one and must resync from a snapshot. */
function integrateEvents(state, incoming) {
  let { revision, cells } = state;
  let copied = false;
  let needsResync = false;
  const confirmed = [];

  for (const event of [...incoming].sort((left, right) => left.seq - right.seq)) {
    if (event.seq <= revision) continue;
    if (event.seq !== revision + 1) { needsResync = true; break; }
    if (!copied) { cells = { ...cells }; copied = true; }
    if (event.value === null) delete cells[event.cellId];
    else cells[event.cellId] = {
      value: event.value,
      isMasked: Boolean(event.isMasked),
      locked: Boolean(event.isMasked),
      formula: event.formula,
      authorId: event.authorId,
      authorName: event.authorName,
      authorRole: event.authorRole,
      revision: event.seq,
      timestamp: event.timestamp,
    };
    revision = event.seq;
    confirmed.push(event.opId);
  }

  const next = { ...state, cells, revision, needsResync: state.needsResync || needsResync };
  return confirmed.length ? withPending(next, removePending(state.pending, confirmed)) : next;
}

const pushNotice = (state, level, title, detail) => ({
  ...state,
  notices: [...state.notices.slice(-3), { id: ++noticeSequence, level, title, detail }],
});

const TERMINAL_NOTICES = {
  REJECTED: ['error', 'Edit rejected'],
  ROLLED_BACK: ['error', 'Edit rolled back'],
  SUPERSEDED: ['info', 'Edit superseded'],
};

export function sheetReducer(state, action) {
  switch (action.type) {
    case 'SNAPSHOT_LOADED': {
      const pruned = { ...state.pending, byId: { ...state.pending.byId } };
      const acked = pruned.order.filter((opId) => pruned.byId[opId].acked);
      const base = withPending(
        { ...state, phase: 'ready', sheet: action.snapshot.sheet, cells: action.snapshot.cells, revision: action.snapshot.revision, snapshotLoaded: true, needsResync: false, eventBuffer: [] },
        removePending(pruned, acked),
      );
      return integrateEvents(base, state.eventBuffer);
    }
    case 'LOAD_FAILED':
      return state.snapshotLoaded ? pushNotice(state, 'error', 'Sync failed', action.message) : { ...state, phase: 'error', error: action.message };
    case 'SERVER_EVENTS':
      return state.snapshotLoaded
        ? integrateEvents(state, action.events)
        : { ...state, eventBuffer: [...state.eventBuffer, ...action.events] };
    case 'LOCAL_MUTATION': {
      const { op } = action;
      const pending = { byId: { ...state.pending.byId, [op.opId]: { op, acked: false } }, order: [...state.pending.order, op.opId] };
      return {
        ...state,
        pending,
        overlay: { ...state.overlay, [op.cellId]: { value: op.value, isMasked: false, locked: false, pending: true } },
      };
    }
    case 'HYDRATE_PENDING': {
      const byId = { ...state.pending.byId };
      const order = [...state.pending.order];
      for (const op of action.ops) {
        if (!byId[op.opId]) { byId[op.opId] = { op, acked: false }; order.push(op.opId); }
      }
      return withPending(state, { byId, order });
    }
    case 'OPS_RESULTS': {
      const byId = { ...state.pending.byId };
      const terminal = [];
      let next = state;
      for (const result of action.results) {
        const entry = byId[result.opId];
        if (!entry) continue;
        if (result.status === 'APPLIED') {
          byId[result.opId] = { ...entry, acked: true };
          continue;
        }
        terminal.push(result.opId);
        const notice = TERMINAL_NOTICES[result.status];
        if (notice) {
          const where = state.sheet ? coordinateOf(entry.op.cellId, state.sheet.columns) : entry.op.cellId;
          const detail = result.status === 'SUPERSEDED'
            ? `${where} was changed concurrently; the higher-ranked edit won.`
            : `${where}: ${result.message ?? 'The server declined this change.'}`;
          next = pushNotice(next, notice[0], notice[1], detail);
        }
      }
      return withPending(next, removePending({ ...state.pending, byId }, terminal));
    }
    case 'HISTORY_PUSH': {
      const stack = [...state.history[action.stack], action.entry].slice(-HISTORY_LIMIT);
      return { ...state, history: { ...state.history, [action.stack]: stack, ...(action.clearRedo ? { redo: [] } : {}) } };
    }
    case 'HISTORY_POP':
      return { ...state, history: { ...state.history, [action.stack]: state.history[action.stack].slice(0, -1) } };
    case 'PRESENCE_SET':
      return { ...state, presence: Object.fromEntries(action.entries.map((entry) => [entry.socketId, entry])) };
    case 'PRESENCE_UPSERT':
      return { ...state, presence: { ...state.presence, [action.entry.socketId]: action.entry } };
    case 'PRESENCE_REMOVE': {
      const { [action.socketId]: _removed, ...rest } = state.presence;
      return { ...state, presence: rest };
    }
    case 'NOTICE':
      return pushNotice(state, action.level, action.title, action.detail);
    case 'NOTICE_DISMISS':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };
    default:
      return state;
  }
}
