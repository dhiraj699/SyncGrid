const payloadOf = (value, isMasked) => ({ value, isMasked: Boolean(isMasked), locked: Boolean(isMasked) });

export function applyForward(cells, event) {
  if (event.value === null) delete cells[event.cellId];
  else cells[event.cellId] = payloadOf(event.value, event.isMasked);
}

/** Events carry previousValue, so the log can be walked backwards without re-folding from the baseline. */
export function applyBackward(cells, event) {
  if (event.previousValue === null) delete cells[event.cellId];
  else cells[event.cellId] = payloadOf(event.previousValue, event.isMasked);
}

/** Net change per cell across events[from, to). Positions are event counts after the baseline. */
export function summarizeDiff(events, from, to) {
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  const byCell = new Map();

  for (let index = lower; index < upper; index += 1) {
    const event = events[index];
    const entry = byCell.get(event.cellId) ?? { cellId: event.cellId, before: event.previousValue, edits: 0, authors: new Set() };
    entry.after = event.value;
    entry.edits += 1;
    entry.authors.add(event.authorId);
    entry.lastAuthorId = event.authorId;
    entry.lastTimestamp = event.timestamp;
    entry.isMasked = Boolean(event.isMasked);
    byCell.set(event.cellId, entry);
  }

  return Array.from(byCell.values(), (entry) => ({
    ...entry,
    authors: [...entry.authors],
    kind: entry.before === entry.after ? 'reverted' : entry.before === null ? 'added' : entry.after === null ? 'cleared' : 'modified',
  }));
}
