# SyncGrid

Collaborative spreadsheet engine built around an **append-only event log**, **role-based cell masking on the wire**, and **offline-first deterministic sync**. MERN stack (MongoDB, Express, React, Node) with Socket.io.

The demo workspace is a 50,000-cell warehouse inventory ledger (5,000 rows × 10 columns) with confidential Wholesale and Margin columns.

## Run it

Requires Node 20+.

```bash
npm install

# Option A: MongoDB Atlas / local Mongo
cp backend/.env.example backend/.env      # set MONGODB_URI
docker compose up -d mongo                # optional local Mongo, then MONGODB_URI=mongodb://localhost:27017/syncgrid
npm run dev:backend                       # http://localhost:4000

# Option B: no database (in-memory store, state resets on restart)
STORE_DRIVER=memory npm run dev:backend

npm run dev:frontend                      # http://localhost:5173
```

First boot seeds the sheet and four demo users (default credentials configured in `.env` via `DEMO_PASSWORD`):

| User | Role | Name | What to try |
|---|---|---|---|
| dhirajdk09062006@gmail.com | ADMIN | Dhiraj Kumar | History drawer, audit diff, toggle a column's confidential lock, full CSV export |
| d24950528@gmail.com | MANAGER | Suraj Kumar | Edit confidential cells, raw CSV export, no history or schema access |
| ansh.raj@syncgrid.dev | STAFF | Ansh Raj | Wholesale and Margin masked; only On hand, Reorder at, Status editable; masked CSV export |
| niraj.nayak@syncgrid.dev | STAFF | Niraj Kumar Nayak | Wholesale and Margin masked; only On hand, Reorder at, Status editable; masked CSV export |

Open two browsers as different users to see presence, live edits and conflict resolution. Use **Go offline** in the status bar, edit a few cells, then **Go online**.

```bash
npm test          # 17 backend tests: engine unit tests + HTTP/Socket.io integration
npm run build     # production frontend build
```

## Architecture

```
backend/src
  engine/      vectorClock · transform (conflict rules) · sequencer (tick batching)
               sheetSession (apply, rollback, snapshot) · persistenceWorker · historyService
  security/    masking: the only place values are projected per role
  domain/      access (roles, permissions, column masks) · cellId
  persistence/ MongoStore · MemoryStore (same contract)
  transport/   http (REST) · ws (Socket.io gateway) · zod schemas
frontend/src
  state/       sheetReducer (confirmed cells + optimistic overlay + history stacks)
  hooks/       useSheetSync (outbox, clocks, socket lifecycle) · useReplay · useAuth
  services/    apiClient · socketClient · offlineQueue (Dexie)
  components/  Grid (virtualised) · History (time travel) · Shell
```

### Event sourcing
Sheets are never stored as a 2D array. Every accepted mutation is a `CellMutationEvent` `{ sheetId, seq, opId, cellId, opType, value, previousValue, authorId, authorRole, vectorClock, lamport, timestamp }`. The collection is append-only (Mongoose blocks query-level updates and deletes; unique indexes on `(sheetId, seq)` and `(sheetId, opId)`). A `cell_states` collection is a materialised projection for fast startup; if a crash leaves it behind the log, the session replays the tail on load.

### Concurrency and transformation
- Submissions are batched per **tick** (default 8 ms) by `TickSequencer`, so concurrent edits are ordered together rather than by arrival.
- Within a tick, units are sorted by a strict total order: **Lamport timestamp, then role priority, then author id, then op id**. Arrival order cannot change the result (covered by a permutation test).
- Each op is checked against the target cell's causal state using **vector clocks**. Causally after the last write: applied. Causally before it: `SUPERSEDED`. Concurrent: the higher ordering key wins.
- Ops are idempotent by `opId` (`DUPLICATE`), which makes reconnect re-sends safe.
- `atomic: true` submissions are all-or-nothing: a schema or permission violation unwinds the journal and returns `ROLLED_BACK` for the group.

### Role-based masking
`permissionMaskFor(role, column)` yields `{ canRead, canWrite }`. Masking happens in `security/masking.js` for snapshots, history baselines, event pages, catch-up and live broadcasts. Broadcasts go to **per-role Socket.io rooms**, so each role receives only a payload projected for it. Restricted roles receive `{ value: "••••", isMasked: true, locked: true }`, and masked events never carry `value` or `previousValue`. The browser tests assert that a STAFF socket's frames never contain a confidential number written by a manager.

### Persistence
Sessions hold live state in memory. `PersistenceWorker` coalesces events and dirty cells and writes them with `bulkWrite()` after a 2-second quiet window (10 s max wait so a busy sheet still flushes). Failed batches are requeued with exponential backoff; shutdown flushes.

### Offline-first
Every local edit is written to an **IndexedDB outbox (Dexie)** before it is sent and removed only when the server acknowledges it, so online and offline share one path. On reconnect the client rejoins with its last revision, receives masked catch-up events, then flushes the outbox in batches. The server returns per-op outcomes (`APPLIED`, `SUPERSEDED`, `DUPLICATE`, `REJECTED`) and a `reconciled` confirmation; no path throws to the socket, and every handler replies with a structured error. Vector clocks are merged from snapshots and events, so a user who has seen the latest state never loses to a stale concurrent edit.

### Grid
`@tanstack/react-virtual` mounts only viewport rows plus a 5-row overscan (≈30 of 5,000 rows). Rows are memoised on the identity of their cell payloads, so a remote edit re-renders one row. Keyboard: arrows, Enter (edit / commit and move down), Tab (commit and move right), Escape (cancel), F2, Delete, Page Up/Down, Home/End, type-to-edit. **Undo/redo is selective**: the inverse is applied as a new forward mutation, and only if the cell still holds what the user wrote, so a collaborator's later edit is never reverted.

### Time travel
Admins fetch the baseline and event pages once. Scrubbing walks events forwards or backwards in memory using `previousValue`, so cost is proportional to distance moved, not sheet size. The audit diff aggregates net change per cell between two positions, with authors and edit counts.

## Known limits
- One API process owns each sheet's sequencer. Horizontal scale needs sticky routing per `sheetId` (or the Socket.io Redis adapter plus a sheet-affinity layer).
- Up to `PERSIST_DEBOUNCE_MS` of acknowledged events live only in memory; a hard crash in that window loses them (clients still hold unacked ops in their outbox and re-send).
- Vector clocks grow with distinct client ids (one per browser tab); prune or bucket for very long-lived sheets.
- Row/column structure is fixed; structural operations (insert/delete row) would need index transformation on top of the current cell-level model.
- Demo auth uses seeded users and JWTs; swap `AuthService` for your IdP.
