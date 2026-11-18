import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { io as connect } from 'socket.io-client';

const PORT = 4555;
const BASE = `http://localhost:${PORT}`;
const SHEET = 'inventory-q4';
let server;

const TEST_AUTH_SECRET = process.env.DEMO_PASSWORD || 'test-ephemeral-secret-auth';

const login = async (email, password = TEST_AUTH_SECRET) => {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
};

const api = (path, token) => fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });

const openSocket = async (token) => {
  const socket = connect(BASE, { auth: { token }, transports: ['websocket'] });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const frames = [];
  socket.onAny((_event, payload) => frames.push(JSON.stringify(payload)));
  const join = await socket.emitWithAck('sheet:join', { sheetId: SHEET });
  return { socket, join, frames };
};

let counter = 0;
const makeOp = (cellId, value, vectorClock, lamport) => ({
  opId: `itest-${String(++counter).padStart(6, '0')}`, cellId, opType: 'SET', value, vectorClock, lamport, clientTimestamp: Date.now(),
});

before(async () => {
  let errOutput = '';
  process.env.DEMO_PASSWORD = TEST_AUTH_SECRET;
  server = spawn('node', ['src/server.js'], {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    env: {
      ...process.env,
      STORE_DRIVER: 'memory',
      PORT: String(PORT),
      SEED_ROWS: '100',
      PERSIST_DEBOUNCE_MS: '50',
      LOG_LEVEL: 'silent',
      DEMO_PASSWORD: TEST_AUTH_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => { errOutput += d.toString(); });
  server.stdout.on('data', (d) => { errOutput += d.toString(); });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not start: ${errOutput}`);
});

after(() => server?.kill('SIGTERM'));

describe('SyncGrid API', () => {
  it('rejects unauthenticated access', async () => {
    assert.equal((await fetch(`${BASE}/api/sheets/${SHEET}`)).status, 401);
  });

  it('serves role-masked snapshots over REST', async () => {
    const manager = await login('d24950528@gmail.com');
    const staff = await login('ansh.raj@syncgrid.dev');
    const managerSheet = await (await api(`/api/sheets/${SHEET}`, manager.token)).json();
    const staffRaw = await (await api(`/api/sheets/${SHEET}`, staff.token)).text();
    const staffSheet = JSON.parse(staffRaw);

    const managerPrice = managerSheet.cells['0:wholesale_price'].value;
    assert.equal(typeof managerPrice, 'number');
    assert.deepEqual(staffSheet.cells['0:wholesale_price'], { value: '••••', isMasked: true, locked: true });
    assert.deepEqual(staffSheet.cells['0:margin'], { value: '••••', isMasked: true, locked: true });
    assert.ok(!/"\d+:(wholesale_price|margin)":\{"value":\d/.test(staffRaw), 'no numeric confidential value anywhere in the staff payload');
    assert.equal(staffSheet.sheet.columns.find((column) => column.key === 'margin').permissionMask.canRead, false);
  });

  it('exports role-safe CSV with confidential columns masked for staff and raw for managers', async () => {
    const manager = await login('d24950528@gmail.com');
    const staff = await login('ansh.raj@syncgrid.dev');

    const managerCsv = await (await api(`/api/sheets/${SHEET}/export`, manager.token)).text();
    const staffCsv = await (await api(`/api/sheets/${SHEET}/export`, staff.token)).text();

    assert.ok(managerCsv.startsWith('"SKU","Product"'));
    assert.ok(staffCsv.startsWith('"SKU","Product"'));
    assert.ok(staffCsv.includes('••••'), 'Staff CSV must include •••• placeholder for confidential columns');
    assert.ok(!managerCsv.includes('••••'), 'Manager CSV must not include ••••');
  });

  it('restricts history to auditors', async () => {
    const admin = await login('dhirajdk09062006@gmail.com');
    const manager = await login('d24950528@gmail.com');
    assert.equal((await api(`/api/sheets/${SHEET}/history/baseline`, manager.token)).status, 403);
    const baseline = await (await api(`/api/sheets/${SHEET}/history/baseline`, admin.token)).json();
    assert.equal(baseline.baselineSeq, 1000);
  });

  it('broadcasts masked events to staff, raw to managers, and resolves a concurrent race', async () => {
    const manager = await login('d24950528@gmail.com');
    const staff = await login('ansh.raj@syncgrid.dev');
    const admin = await login('dhirajdk09062006@gmail.com');
    const [m, s, a] = await Promise.all([openSocket(manager.token), openSocket(staff.token), openSocket(admin.token)]);

    const sentinel = 987654.32;
    const waitForStaffEvent = new Promise((resolve) => s.socket.once('sheet:events', resolve));
    const waitForManagerEvent = new Promise((resolve) => m.socket.once('sheet:events', resolve));
    await m.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: [makeOp('1:wholesale_price', sentinel, { mgr: 1 }, 1)] });

    const [staffEvent, managerEvent] = await Promise.all([waitForStaffEvent, waitForManagerEvent]);
    assert.equal(managerEvent.events[0].value, sentinel);
    assert.equal(staffEvent.events[0].isMasked, true);
    assert.ok(s.frames.every((frame) => !frame.includes('987654')), 'staff wire frames never contain the confidential number');

    const staffAttempt = await s.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: [makeOp('1:wholesale_price', 1, { st: 1 }, 1)] });
    assert.equal(staffAttempt.results[0].reason, 'FORBIDDEN');

    const [adminResult, staffResult] = await Promise.all([
      a.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: [makeOp('2:stock', 111, { adm: 1 }, 7)] }),
      s.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: [makeOp('2:stock', 222, { st: 2 }, 7)] }),
    ]);
    assert.equal(adminResult.results[0].status, 'APPLIED');
    assert.equal(staffResult.results[0].status, 'APPLIED', 'both sequenced in the same tick; loser is overwritten, not dropped');
    const final = await (await api(`/api/sheets/${SHEET}`, admin.token)).json();
    assert.equal(final.cells['2:stock'].value, 111, 'ADMIN outranks STAFF at equal lamport');

    [m, s, a].forEach(({ socket }) => socket.disconnect());
  });

  it('reconciles an offline batch idempotently and reports catch-up after reconnect', async () => {
    const staff = await login('niraj.nayak@syncgrid.dev');
    const admin = await login('dhirajdk09062006@gmail.com');
    const offline = await openSocket(staff.token);
    const baseRevision = offline.join.revision;

    const online = await openSocket(admin.token);
    await online.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: [makeOp('3:stock', 500, { adm: 9 }, 50)] });

    const queued = [
      makeOp('3:stock', 5, { niraj: 1 }, 2),
      makeOp('4:stock', 6, { niraj: 2 }, 3),
      makeOp('4:stock', 'bogus', { niraj: 3 }, 4),
    ];
    const first = await offline.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: queued });
    assert.deepEqual(first.results.map((result) => result.status), ['SUPERSEDED', 'APPLIED', 'REJECTED']);
    assert.equal(first.reconciled, true);

    const retry = await offline.socket.emitWithAck('ops:submit', { sheetId: SHEET, ops: queued });
    assert.equal(retry.results[1].status, 'DUPLICATE');

    offline.socket.disconnect();
    const reconnected = await openSocket(staff.token);
    const rejoin = await reconnected.socket.emitWithAck('sheet:join', { sheetId: SHEET, lastKnownRevision: baseRevision });
    assert.ok(rejoin.catchUp.length >= 2);
    [online, reconnected].forEach(({ socket }) => socket.disconnect());
  });
});
