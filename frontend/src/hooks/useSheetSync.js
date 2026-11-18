import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { coordinateOf, parseCellId } from '../domain/cellId.js';
import { parseCellInput } from '../domain/parseInput.js';
import { mergeClock } from '../domain/vectorClock.js';
import { api } from '../services/apiClient.js';
import { offlineQueue } from '../services/offlineQueue.js';
import { createSheetSocket, emitWithAck } from '../services/socketClient.js';
import { createInitialState, displayValue, sheetReducer } from '../state/sheetReducer.js';
import { useOnlineStatus } from './useOnlineStatus.js';

const FLUSH_BATCH_SIZE = 200;
const PRESENCE_THROTTLE_MS = 60;
const RETRY_DELAY_MS = 2_000;

const tabId = (() => {
  try {
    const existing = sessionStorage.getItem('syncgrid.tab');
    if (existing) return existing;
    const created = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
    sessionStorage.setItem('syncgrid.tab', created);
    return created;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
})();

const newOpId = () => crypto.randomUUID();

/**
 * Owns the full client sync lifecycle for one sheet: durable outbox, vector
 * clock, socket join/catch-up, optimistic overlay and selective undo/redo.
 * Every send path goes through the outbox, so online and offline editing
 * share one code path.
 */
export function useSheetSync({ sheetId, token, user }) {
  const [state, dispatch] = useReducer(sheetReducer, undefined, createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const online = useOnlineStatus();
  const [forcedOffline, setForcedOffline] = useState(false);
  const [connection, setConnection] = useState('connecting');
  const [syncEpoch, setSyncEpoch] = useState(0);

  const networkAllowedRef = useRef(true);
  networkAllowedRef.current = online && !forcedOffline;

  const clientId = `${user.id}-${tabId}`;
  const clockRef = useRef({ vector: {}, lamport: 0 });
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const flushingRef = useRef(false);
  const sentRef = useRef(new Set());
  const presenceTimerRef = useRef(null);
  const retryTimerRef = useRef(null);

  const notify = useCallback((level, title, detail) => dispatch({ type: 'NOTICE', level, title, detail }), []);

  const observe = useCallback((vectorClock, lamport) => {
    mergeClock(clockRef.current.vector, vectorClock ?? {});
    clockRef.current.lamport = Math.max(clockRef.current.lamport, lamport ?? 0);
  }, []);

  const loadSnapshot = useCallback(async () => {
    try {
      const snapshot = await api.getSheet(sheetId);
      observe(snapshot.vectorClock, snapshot.lamport);
      dispatch({ type: 'SNAPSHOT_LOADED', snapshot });
    } catch (error) {
      dispatch({ type: 'LOAD_FAILED', message: error.message });
      throw error;
    }
  }, [sheetId, observe]);

  useEffect(() => {
    let disposed = false;
    offlineQueue.loadForSheet(sheetId).then((ops) => {
      if (disposed || ops.length === 0) return;
      for (const op of ops) observe(op.vectorClock, op.lamport);
      dispatch({ type: 'HYDRATE_PENDING', ops });
    }).catch(() => notify('error', 'Offline storage unavailable', 'Edits will not survive a page reload.'));
    return () => { disposed = true; };
  }, [sheetId, observe, notify]);

  useEffect(() => {
    let disposed = false;
    const socket = createSheetSocket(token);
    socketRef.current = socket;

    const joinSheet = async () => {
      try {
        const alreadyLoaded = stateRef.current.snapshotLoaded;
        const ack = await emitWithAck(socket, 'sheet:join', {
          sheetId,
          ...(alreadyLoaded ? { lastKnownRevision: stateRef.current.revision } : {}),
        });
        if (!ack.ok) throw new Error(ack.error.message);
        observe(ack.vectorClock, ack.lamport);
        dispatch({ type: 'PRESENCE_SET', entries: ack.presence });
        if (ack.catchUp?.length) {
          for (const event of ack.catchUp) observe(event.vectorClock, event.lamport);
          dispatch({ type: 'SERVER_EVENTS', events: ack.catchUp });
        }
        if (!alreadyLoaded || ack.resyncRequired) await loadSnapshot();
        if (disposed) return;
        joinedRef.current = true;
        setConnection('live');
        setSyncEpoch((epoch) => epoch + 1);
      } catch (error) {
        if (!disposed) notify('error', 'Could not join sheet', error.message);
      }
    };

    socket.on('connect', () => {
      joinedRef.current = false;
      sentRef.current.clear();
      void joinSheet();
    });
    socket.on('disconnect', () => {
      joinedRef.current = false;
      sentRef.current.clear();
      setConnection('offline');
    });
    socket.on('connect_error', () => setConnection('offline'));
    socket.on('sheet:events', ({ events }) => {
      for (const event of events) observe(event.vectorClock, event.lamport);
      dispatch({ type: 'SERVER_EVENTS', events });
    });
    socket.on('sheet:resync', () => void loadSnapshot().catch(() => {}));
    socket.on('presence:update', (entry) => dispatch({ type: 'PRESENCE_UPSERT', entry }));
    socket.on('presence:leave', ({ socketId }) => dispatch({ type: 'PRESENCE_REMOVE', socketId }));

    if (networkAllowedRef.current) socket.connect();
    else setConnection('offline');

    return () => {
      disposed = true;
      clearTimeout(presenceTimerRef.current);
      clearTimeout(retryTimerRef.current);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sheetId, token, observe, loadSnapshot, notify]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (online && !forcedOffline) {
      if (!socket.connected) { setConnection('connecting'); socket.connect(); }
    } else {
      socket.disconnect();
      setConnection('offline');
    }
  }, [online, forcedOffline]);

  useEffect(() => {
    if (state.needsResync) void loadSnapshot().catch(() => {});
  }, [state.needsResync, loadSnapshot]);

  const flushOutbox = useCallback(async () => {
    const socket = socketRef.current;
    if (flushingRef.current || !joinedRef.current || !socket) return;
    flushingRef.current = true;
    try {
      while (joinedRef.current) {
        const { byId, order } = stateRef.current.pending;
        const batch = [];
        for (const opId of order) {
          const entry = byId[opId];
          if (!entry.acked && !sentRef.current.has(opId)) batch.push(entry.op);
          if (batch.length === FLUSH_BATCH_SIZE) break;
        }
        if (batch.length === 0) break;

        for (const op of batch) sentRef.current.add(op.opId);
        let ack;
        try {
          ack = await emitWithAck(socket, 'ops:submit', { sheetId, ops: batch, atomic: false });
        } catch (error) {
          for (const op of batch) sentRef.current.delete(op.opId);
          throw error;
        }

        const results = ack.ok
          ? ack.results
          : batch.map((op) => ({ opId: op.opId, status: 'REJECTED', reason: ack.error.code, message: ack.error.message }));
        dispatch({ type: 'OPS_RESULTS', results });
        await offlineQueue.remove(results.map((result) => result.opId));
      }
    } catch {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => setSyncEpoch((epoch) => epoch + 1), RETRY_DELAY_MS);
    } finally {
      flushingRef.current = false;
    }
  }, [sheetId]);

  useEffect(() => {
    if (connection === 'live') void flushOutbox();
  }, [connection, syncEpoch, state.pending.order.length, flushOutbox]);

  const commitCell = useCallback((cellId, rawInput, { record = true } = {}) => {
    const current = stateRef.current;
    const column = current.sheet?.columns.find((candidate) => candidate.key === parseCellId(cellId).columnKey);
    if (!column?.permissionMask.canWrite) {
      notify('error', 'Cell is read-only', `${column?.label ?? 'This column'} is not editable with your role.`);
      return false;
    }
    const parsed = parseCellInput(column, rawInput);
    if (!parsed.ok) {
      notify('error', 'Invalid value', parsed.message);
      return false;
    }
    const before = displayValue(current, cellId);
    if (before === parsed.value) return true;

    const clock = clockRef.current;
    clock.vector[clientId] = (clock.vector[clientId] ?? 0) + 1;
    clock.lamport += 1;
    const op = {
      opId: newOpId(),
      sheetId,
      cellId,
      opType: parsed.value === null ? 'CLEAR' : 'SET',
      value: parsed.value,
      vectorClock: { ...clock.vector },
      lamport: clock.lamport,
      clientTimestamp: Date.now(),
    };

    dispatch({ type: 'LOCAL_MUTATION', op });
    if (record) dispatch({ type: 'HISTORY_PUSH', stack: 'undo', entry: { cellId, before, after: parsed.value }, clearRedo: true });
    offlineQueue.enqueue(op).catch(() => notify('error', 'Offline storage unavailable', 'This edit will not survive a page reload.'));
    return true;
  }, [clientId, sheetId, notify]);

  /**
   * Selective undo: replays the inverse as a new forward mutation, and only when
   * the cell still holds what this user wrote, so a collaborator's later edit is never reverted.
   */
  const stepHistory = useCallback((stack) => {
    const current = stateRef.current;
    const entry = current.history[stack].at(-1);
    if (!entry) return;
    dispatch({ type: 'HISTORY_POP', stack });

    const expected = stack === 'undo' ? entry.after : entry.before;
    const target = stack === 'undo' ? entry.before : entry.after;
    if (displayValue(current, entry.cellId) !== expected) {
      const where = coordinateOf(entry.cellId, current.sheet.columns);
      notify('info', `Skipped ${stack}`, `${where} was changed by someone else since your edit.`);
      return;
    }
    if (commitCell(entry.cellId, target, { record: false })) {
      dispatch({ type: 'HISTORY_PUSH', stack: stack === 'undo' ? 'redo' : 'undo', entry, clearRedo: false });
    }
  }, [commitCell, notify]);

  const announceSelection = useCallback((cellId) => {
    clearTimeout(presenceTimerRef.current);
    presenceTimerRef.current = setTimeout(() => {
      const socket = socketRef.current;
      if (socket?.connected && joinedRef.current) socket.emit('presence:select', { sheetId, cellId });
    }, PRESENCE_THROTTLE_MS);
  }, [sheetId]);

  return {
    state,
    connection,
    forcedOffline,
    toggleOffline: useCallback(() => setForcedOffline((value) => !value), []),
    commitCell,
    undo: useCallback(() => stepHistory('undo'), [stepHistory]),
    redo: useCallback(() => stepHistory('redo'), [stepHistory]),
    announceSelection,
    dismissNotice: useCallback((id) => dispatch({ type: 'NOTICE_DISMISS', id }), []),
    notify,
    refresh: loadSnapshot,
  };
}
