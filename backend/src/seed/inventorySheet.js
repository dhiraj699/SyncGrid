import bcrypt from 'bcryptjs';

export const INVENTORY_SHEET_ID = 'inventory-q4';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo-auth-password';
export const SEED_VERSION = 'v2-prod-team';

const CATEGORIES = ['Fasteners', 'Bearings', 'Hydraulics', 'Electrical', 'Safety Gear', 'Tooling', 'Packaging'];
const STATUSES = ['In stock', 'Low stock', 'Backordered', 'Discontinued'];
const SUPPLIERS = ['Northwind Industrial', 'Halcyon Supply Co.', 'Brightline Metals', 'Kestrel Components', 'Ardent Logistics', 'Orion Fabrication'];
const PRODUCT_LINES = {
  Fasteners: ['Hex Bolt', 'Lock Nut', 'Flange Screw', 'Anchor Stud'],
  Bearings: ['Ball Bearing', 'Tapered Roller', 'Pillow Block', 'Thrust Washer'],
  Hydraulics: ['Gear Pump', 'Check Valve', 'Hose Assembly', 'Pressure Gauge'],
  Electrical: ['Contactor', 'Relay Module', 'Terminal Block', 'Cable Gland'],
  'Safety Gear': ['Nitrile Glove', 'Face Shield', 'Hard Hat', 'Ear Defender'],
  Tooling: ['Carbide Insert', 'Torque Wrench', 'Drill Bit Set', 'Bench Vise'],
  Packaging: ['Pallet Wrap', 'Corner Guard', 'Strapping Roll', 'Foam Insert'],
};
const SPECS = ['M6', 'M8', 'M10', '12 mm', '25 mm', '50 mm', 'Type A', 'Grade 8', 'HD', 'Series 300'];

export const INVENTORY_COLUMNS = [
  { key: 'sku', label: 'SKU', type: 'text', width: 128, required: true, pattern: '^SG-\\d{6}$' },
  { key: 'name', label: 'Product', type: 'text', width: 232, required: true },
  { key: 'category', label: 'Category', type: 'select', width: 140, options: CATEGORIES },
  { key: 'supplier', label: 'Supplier', type: 'select', width: 188, options: SUPPLIERS },
  { key: 'stock', label: 'On hand', type: 'integer', width: 100, min: 0, max: 1_000_000, staffEditable: true },
  { key: 'reorder_point', label: 'Reorder at', type: 'integer', width: 108, min: 0, max: 1_000_000, staffEditable: true },
  { key: 'unit_price', label: 'List price', type: 'currency', width: 112, min: 0 },
  { key: 'wholesale_price', label: 'Wholesale', type: 'currency', width: 116, min: 0, confidential: true },
  { key: 'margin', label: 'Margin', type: 'percent', width: 96, min: -100, max: 100, confidential: true },
  { key: 'status', label: 'Status', type: 'select', width: 132, options: STATUSES, staffEditable: true },
].map((column) => ({ confidential: false, staffEditable: false, required: false, ...column }));

export const DEMO_USERS = [
  { id: 'usr_dhiraj', email: 'dhirajdk09062006@gmail.com', name: 'Dhiraj Kumar', initials: 'DK', color: '#f97316', role: 'ADMIN' },
  { id: 'usr_suraj', email: 'd24950528@gmail.com', name: 'Suraj Kumar', initials: 'SK', color: '#facc15', role: 'MANAGER' },
  { id: 'usr_ansh', email: 'ansh.raj@syncgrid.dev', name: 'Ansh Raj', initials: 'AR', color: '#34d399', role: 'STAFF' },
  { id: 'usr_niraj', email: 'niraj.nayak@syncgrid.dev', name: 'Niraj Kumar Nayak', initials: 'NN', color: '#38bdf8', role: 'STAFF' },
];

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function* generateRows(rowCount) {
  const rng = createRng(20260612);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const category = CATEGORIES[rowIndex % CATEGORIES.length];
    const stock = rng() < 0.04 ? 0 : Math.floor(rng() * 1200);
    const reorderPoint = 20 + Math.floor(rng() * 180);
    const unitPrice = round(5 + rng() * 495, 2);
    const wholesale = round(unitPrice * (0.45 + rng() * 0.35), 2);
    const status = stock === 0 ? 'Backordered' : stock < reorderPoint ? 'Low stock' : rng() < 0.03 ? 'Discontinued' : 'In stock';
    yield {
      rowIndex,
      values: {
        sku: `SG-${String(100000 + rowIndex)}`,
        name: `${pick(rng, PRODUCT_LINES[category])} ${pick(rng, SPECS)}`,
        category,
        supplier: pick(rng, SUPPLIERS),
        stock,
        reorder_point: reorderPoint,
        unit_price: unitPrice,
        wholesale_price: wholesale,
        margin: round(((unitPrice - wholesale) / unitPrice) * 100, 1),
        status,
      },
    };
  }
}

function getAuthorForCell(column, rowIndex) {
  if (column.confidential) {
    return rowIndex % 2 === 0 ? DEMO_USERS[0] : DEMO_USERS[1];
  }
  if (column.staffEditable) {
    const slot = (rowIndex + column.key.length) % 4;
    if (slot === 0) return DEMO_USERS[2]; // Ansh Raj (Staff)
    if (slot === 1) return DEMO_USERS[3]; // Niraj Kumar Nayak (Staff)
    if (slot === 2) return DEMO_USERS[1]; // Suraj Kumar (Manager)
    return DEMO_USERS[0]; // Dhiraj Kumar (Admin)
  }
  return (rowIndex + column.key.length) % 2 === 0 ? DEMO_USERS[0] : DEMO_USERS[1];
}

const PERSIST_CHUNK = 5_000;

export async function ensureSeedData({ store, config, logger, force = false }) {
  const seedPassword = config?.DEMO_PASSWORD || process.env.DEMO_PASSWORD || DEMO_PASSWORD;
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  await store.upsertUsers(DEMO_USERS.map((user) => ({ ...user, passwordHash })));

  const existing = await store.getSheet(INVENTORY_SHEET_ID);
  if (existing && existing.seedVersion === SEED_VERSION && !force) return;

  if (existing) {
    logger.info({ sheetId: INVENTORY_SHEET_ID }, 'updating existing sheet seed to latest production team version');
    if (typeof store.clearSheet === 'function') {
      await store.clearSheet(INVENTORY_SHEET_ID);
    }
  }

  const startedAt = Date.now();
  const seededAt = startedAt;
  let seq = 0;
  let events = [];
  let cellStates = [];

  const flushChunk = async () => {
    await store.bulkPersist({ sheetId: INVENTORY_SHEET_ID, events, cellStates });
    events = [];
    cellStates = [];
  };

  for (const { rowIndex, values } of generateRows(config.SEED_ROWS)) {
    for (const column of INVENTORY_COLUMNS) {
      seq += 1;
      const cellId = `${rowIndex}:${column.key}`;
      const author = getAuthorForCell(column, rowIndex);
      const cellTimestamp = seededAt - Math.max(0, (config.SEED_ROWS - rowIndex) * 60_000);
      const event = {
        sheetId: INVENTORY_SHEET_ID,
        seq,
        opId: `seed-${seq}`,
        cellId,
        opType: 'SET',
        value: values[column.key],
        previousValue: null,
        authorId: author.id,
        authorRole: author.role,
        authorName: author.name,
        vectorClock: {},
        lamport: 0,
        clientTimestamp: cellTimestamp,
        timestamp: cellTimestamp,
      };
      events.push(event);
      cellStates.push({
        cellId,
        value: event.value,
        revision: seq,
        lamport: 0,
        authorId: author.id,
        authorRole: author.role,
        authorName: author.name,
        opId: event.opId,
        vectorClock: {},
        timestamp: cellTimestamp,
      });
    }
    if (events.length >= PERSIST_CHUNK) await flushChunk();
  }
  if (events.length > 0) await flushChunk();

  await store.saveSheet({
    id: INVENTORY_SHEET_ID,
    name: 'Inventory — Q4 Warehouse Ledger',
    rowCount: config.SEED_ROWS,
    baselineSeq: seq,
    columns: INVENTORY_COLUMNS,
    seedVersion: SEED_VERSION,
  });
  logger.info({ cells: seq, ms: Date.now() - startedAt, seedVersion: SEED_VERSION }, 'seeded inventory sheet');
}
