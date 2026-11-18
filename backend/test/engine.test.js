import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import { PersistenceWorker } from '../src/engine/persistenceWorker.js';
import { SheetSession, OpStatus } from '../src/engine/sheetSession.js';
import { ClockRelation, compareClocks } from '../src/engine/vectorClock.js';
import { MASK_PLACEHOLDER, projectEvent } from '../src/security/masking.js';

const silentLogger = { error() {}, info() {}, warn() {}, child() { return this; } };
const CONFIG = { SEQUENCER_TICK_MS: 5, PERSIST_DEBOUNCE_MS: 40, PERSIST_MAX_WAIT_MS: 400 };

const columns = [
  { key: 'sku', label: 'SKU', type: 'text', required: true, confidential: false, staffEditable: false },
  { key: 'stock', label: 'On hand', type: 'integer', min: 0, confidential: false, staffEditable: true },
  { key: 'wholesale', label: 'Wholesale', type: 'currency', min: 0, confidential: true, staffEditable: false },
];

const ADMIN = { id: 'usr_dhiraj', role: 'ADMIN', name: 'Dhiraj Kumar' };
const MANAGER = { id: 'usr_suraj', role: 'MANAGER', name: 'Suraj Kumar' };
const STAFF = { id: 'usr_ansh', role: 'STAFF', name: 'Ansh Raj' };

let opCounter = 0;
const op = (cellId, value, { vectorClock = {}, lamport = 1 } = {}) => ({
  opId: `op-${String(++opCounter).padStart(8, '0')}`,
  cellId,
  opType: value === null ? 'CLEAR' : 'SET',
  value,
  vectorClock,
  lamport,
  clientTimestamp: Date.now(),
});

async function openSession() {
  const store = new MemoryStore();
  await store.saveSheet({ id: 'test-sheet', name: 'Test', rowCount: 10, baselineSeq: 0, columns });
  const session = await SheetSession.open({ sheetId: 'test-sheet', store, config: CONFIG, logger: silentLogger });
  return { store, session };
}

describe('vector clocks', () => {
  it('classifies causal relations', () => {
    assert.equal(compareClocks({ a: 2 }, { a: 1 }), ClockRelation.AFTER);
    assert.equal(compareClocks({ a: 1 }, { a: 2 }), ClockRelation.BEFORE);
    assert.equal(compareClocks({ a: 1 }, { a: 1 }), ClockRelation.EQUAL);
    assert.equal(compareClocks({ a: 2 }, { b: 1 }), ClockRelation.CONCURRENT);
  });
});

describe('sequencer conflict resolution', () => {
  it('converges on the same value for every arrival order of concurrent same-tick edits', async () => {
    const edits = [
      { author: ADMIN, operation: op('0:stock', 10, { vectorClock: { a: 1 }, lamport: 5 }) },
      { author: MANAGER, operation: op('0:stock', 20, { vectorClock: { b: 1 }, lamport: 5 }) },
      { author: STAFF, operation: op('0:stock', 30, { vectorClock: { c: 1 }, lamport: 5 }) },
    ];
    const orders = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]];
    const finals = new Set();

    for (const order of orders) {
      const { session } = await openSession();
      await Promise.all(order.map((index) => session.submit({ author: edits[index].author, ops: [edits[index].operation] })));
      finals.add(session.snapshot('ADMIN').cells['0:stock'].value);
    }
    assert.deepEqual([...finals], [10], 'equal lamport + priority ties resolve to ADMIN regardless of order');
  });

  it('applies a causally later edit and supersedes a stale concurrent one', async () => {
    const { session } = await openSession();
    await session.submit({ author: ADMIN, ops: [op('1:stock', 5, { vectorClock: { a: 1 }, lamport: 10 })] });

    const staleOffline = await session.submit({ author: STAFF, ops: [op('1:stock', 99, { vectorClock: { c: 1 }, lamport: 2 })] });
    assert.equal(staleOffline.results[0].status, OpStatus.SUPERSEDED);

    const informed = await session.submit({ author: STAFF, ops: [op('1:stock', 42, { vectorClock: { a: 1, c: 2 }, lamport: 11 })] });
    assert.equal(informed.results[0].status, OpStatus.APPLIED);
    assert.equal(session.snapshot('ADMIN').cells['1:stock'].value, 42);
  });

  it('treats a replayed opId as a duplicate', async () => {
    const { session } = await openSession();
    const operation = op('2:stock', 7, { vectorClock: { a: 1 } });
    await session.submit({ author: ADMIN, ops: [operation] });
    const replay = await session.submit({ author: ADMIN, ops: [operation] });
    assert.equal(replay.results[0].status, OpStatus.DUPLICATE);
    assert.equal(session.revision, 1);
  });
});

describe('validation and atomic rollback', () => {
  it('rolls back every op in an atomic group when one violates the schema', async () => {
    const { session } = await openSession();
    const { results, revision } = await session.submit({
      author: ADMIN,
      atomic: true,
      ops: [
        op('3:stock', 5, { vectorClock: { a: 1 } }),
        op('3:sku', 'SKU-1', { vectorClock: { a: 2 } }),
        op('3:stock', 'not-a-number', { vectorClock: { a: 3 } }),
      ],
    });
    assert.equal(results[2].status, OpStatus.REJECTED);
    assert.equal(results[2].reason, 'SCHEMA_VIOLATION');
    assert.equal(results[0].status, OpStatus.ROLLED_BACK);
    assert.equal(revision, 0);
    assert.deepEqual(session.snapshot('ADMIN').cells, {});
  });

  it('keeps independent ops in a non-atomic submission', async () => {
    const { session } = await openSession();
    const { results } = await session.submit({
      author: ADMIN,
      ops: [op('4:stock', 5, { vectorClock: { a: 1 } }), op('4:stock', -1, { vectorClock: { a: 2 } })],
    });
    assert.equal(results[0].status, OpStatus.APPLIED);
    assert.equal(results[1].status, OpStatus.REJECTED);
    assert.equal(session.snapshot('ADMIN').cells['4:stock'].value, 5);
  });

  it('refuses to clear a required column', async () => {
    const { session } = await openSession();
    const { results } = await session.submit({ author: ADMIN, ops: [op('5:sku', null, { vectorClock: { a: 1 } })] });
    assert.equal(results[0].reason, 'SCHEMA_VIOLATION');
  });
});

describe('role-based masking', () => {
  it('forbids staff writes to confidential and non-staff-editable columns', async () => {
    const { session } = await openSession();
    const { results } = await session.submit({
      author: STAFF,
      ops: [op('0:wholesale', 12.5, { vectorClock: { c: 1 } }), op('0:sku', 'X', { vectorClock: { c: 2 } }), op('0:stock', 3, { vectorClock: { c: 3 } })],
    });
    assert.deepEqual(results.map((result) => result.status), [OpStatus.REJECTED, OpStatus.REJECTED, OpStatus.APPLIED]);
    assert.equal(results[0].reason, 'FORBIDDEN');
  });

  it('never leaks confidential values in snapshots or events for staff', async () => {
    const { session } = await openSession();
    const committed = new Promise((resolve) => session.once('committed', resolve));
    await session.submit({ author: MANAGER, ops: [op('0:wholesale', 123.45, { vectorClock: { m: 1 } })] });
    const { events } = await committed;

    const staffSnapshot = JSON.stringify(session.snapshot('STAFF'));
    assert.ok(!staffSnapshot.includes('123.45'));
    assert.deepEqual(session.snapshot('STAFF').cells['0:wholesale'], { value: MASK_PLACEHOLDER, isMasked: true, locked: true });

    const staffEvent = projectEvent(events[0], session.columnsByKey, 'STAFF');
    assert.ok(!JSON.stringify(staffEvent).includes('123.45'));
    assert.equal(staffEvent.isMasked, true);
    assert.equal(session.snapshot('MANAGER').cells['0:wholesale'].value, 123.45);
  });
});

describe('persistence', () => {
  it('debounces many ticks into a single bulk write and logs every event', async () => {
    const { store, session } = await openSession();
    for (let index = 0; index < 5; index += 1) {
      await session.submit({ author: ADMIN, ops: [op(`${index}:stock`, index, { vectorClock: { a: index + 1 } })] });
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    assert.equal(store.persistCalls, 0, 'nothing written inside the debounce window');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(store.persistCalls, 1);
    assert.equal((await store.loadEvents('test-sheet')).length, 5);
  });

  it('requeues a failed batch and retries without losing events', async () => {
    let attempts = 0;
    const flaky = {
      async bulkPersist(batch) {
        attempts += 1;
        if (attempts === 1) throw new Error('network partition');
        persisted.push(...batch.events);
      },
    };
    const persisted = [];
    const worker = new PersistenceWorker({ sheetId: 's', store: flaky, debounceMs: 10, maxWaitMs: 100, logger: silentLogger });
    worker.enqueue({ events: [{ seq: 1 }], cellStates: new Map([['0:a', { revision: 1 }]]) });
    await worker.flush();
    assert.equal(persisted.length, 0);
    await worker.flush();
    assert.deepEqual(persisted, [{ seq: 1 }]);
  });

  it('restores state and rebuilds a missing cell-state tail from the event log after restart', async () => {
    const { store, session } = await openSession();
    await session.submit({ author: ADMIN, ops: [op('6:stock', 9, { vectorClock: { a: 1 } })] });
    await session.close();
    const reopened = await SheetSession.open({ sheetId: 'test-sheet', store, config: CONFIG, logger: silentLogger });
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.snapshot('ADMIN').cells['6:stock'].value, 9);
  });
});
