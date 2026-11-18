export function cellStateFromEvent(event) {
  return {
    value: event.value ?? null,
    formula: event.formula ?? null,
    revision: event.seq,
    lamport: event.lamport,
    authorId: event.authorId,
    authorRole: event.authorRole,
    authorName: event.authorName ?? null,
    opId: event.opId,
    vectorClock: event.vectorClock,
    timestamp: event.timestamp,
  };
}

/** Folds an ordered event stream into a cellId -> cell state map. */
export function foldEvents(events, cells = new Map()) {
  for (const event of events) cells.set(event.cellId, cellStateFromEvent(event));
  return cells;
}
