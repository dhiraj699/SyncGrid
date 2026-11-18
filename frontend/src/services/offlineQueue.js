import Dexie from 'dexie';

const db = new Dexie('syncgrid-outbox');
db.version(1).stores({ pendingOps: '&opId, sheetId, enqueuedAt' });

let sequence = 0;

/**
 * Durable outbox. Every local mutation is written here before it is sent and
 * removed only once the server acknowledges it, so a dropped connection, a
 * crash or a closed tab cannot lose an edit. The server de-duplicates by opId,
 * which makes re-sending after any failure safe.
 */
export const offlineQueue = {
  enqueue: (op) => db.pendingOps.put({ ...op, enqueuedAt: Date.now() + (sequence++ % 1000) / 1000 }),
  remove: (opIds) => db.pendingOps.bulkDelete(opIds),
  async loadForSheet(sheetId) {
    const rows = await db.pendingOps.where('sheetId').equals(sheetId).sortBy('enqueuedAt');
    return rows.map(({ enqueuedAt, ...op }) => op);
  },
};
