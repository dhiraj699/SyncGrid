import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormulaEngine, FORMULA_ERRORS, colLettersToIndex, indexToColLetters, parseA1Coordinate } from '../src/engine/formulaEngine.js';

describe('FormulaEngine', () => {
  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'stock', label: 'Stock' },
    { key: 'unit_price', label: 'Price' },
    { key: 'total', label: 'Total' },
  ];
  const rowCount = 100;

  it('converts between coordinates and column indices', () => {
    assert.equal(colLettersToIndex('A'), 0);
    assert.equal(colLettersToIndex('B'), 1);
    assert.equal(colLettersToIndex('Z'), 25);
    assert.equal(colLettersToIndex('AA'), 26);
    assert.equal(indexToColLetters(0), 'A');
    assert.equal(indexToColLetters(1), 'B');
    assert.equal(indexToColLetters(25), 'Z');
    assert.equal(indexToColLetters(26), 'AA');

    assert.deepEqual(parseA1Coordinate('C3'), { colIndex: 2, rowIndex: 2 });
    assert.deepEqual(parseA1Coordinate('E10'), { colIndex: 4, rowIndex: 9 });
  });

  it('evaluates basic arithmetic expressions and cross-cell references', () => {
    const engine = new FormulaEngine({ columns, rowCount });
    const cellStore = {
      '0:stock': 10,
      '0:unit_price': 5.5,
    };
    const getVal = (id) => cellStore[id] ?? null;

    // Total = stock * unit_price (C1 * D1)
    const reg = engine.registerFormula('0:total', '=C1*D1');
    assert.equal(reg.ok, true);
    assert.equal(engine.evaluate('0:total', getVal), 55);

    // Compound arithmetic: =(C1 + 5) * 2
    engine.registerFormula('1:total', '=(C1+5)*2');
    assert.equal(engine.evaluate('1:total', getVal), 30);
  });

  it('evaluates range formulas: SUM, AVG, MIN, MAX, COUNT', () => {
    const engine = new FormulaEngine({ columns, rowCount });
    const cellStore = {
      '0:stock': 10,
      '1:stock': 20,
      '2:stock': 30,
      '3:stock': 40,
    };
    const getVal = (id) => cellStore[id] ?? null;

    // SUM(C1:C4) -> 100
    engine.registerFormula('4:stock', '=SUM(C1:C4)');
    assert.equal(engine.evaluate('4:stock', getVal), 100);

    // AVG(C1:C4) -> 25
    engine.registerFormula('5:stock', '=AVG(C1:C4)');
    assert.equal(engine.evaluate('5:stock', getVal), 25);

    // MIN(C1:C4) -> 10
    engine.registerFormula('6:stock', '=MIN(C1:C4)');
    assert.equal(engine.evaluate('6:stock', getVal), 10);

    // MAX(C1:C4) -> 40
    engine.registerFormula('7:stock', '=MAX(C1:C4)');
    assert.equal(engine.evaluate('7:stock', getVal), 40);

    // COUNT(C1:C4) -> 4
    engine.registerFormula('8:stock', '=COUNT(C1:C4)');
    assert.equal(engine.evaluate('8:stock', getVal), 4);
  });

  it('detects circular references (#CYCLE!) and self references', () => {
    const engine = new FormulaEngine({ columns, rowCount });

    // Self-reference: C1 = =C1 + 1
    const selfReg = engine.registerFormula('0:stock', '=C1+1');
    assert.equal(selfReg.ok, false);
    assert.equal(selfReg.error, FORMULA_ERRORS.CYCLE);
    assert.equal(engine.evaluate('0:stock', () => null), FORMULA_ERRORS.CYCLE);

    // Direct circular: C1 depends on D1, D1 depends on C1
    const regC1 = engine.registerFormula('0:stock', '=D1*2');
    assert.equal(regC1.ok, true);

    const regD1 = engine.registerFormula('0:unit_price', '=C1+10');
    assert.equal(regD1.ok, false);
    assert.equal(regD1.error, FORMULA_ERRORS.CYCLE);
    assert.equal(engine.evaluate('0:unit_price', () => null), FORMULA_ERRORS.CYCLE);
  });

  it('tracks dependents and returns topological order for recalculation', () => {
    const engine = new FormulaEngine({ columns, rowCount });

    // C1 is source
    // D1 = C1 * 2
    // E1 = D1 + 5
    engine.registerFormula('0:unit_price', '=C1*2');
    engine.registerFormula('0:total', '=D1+5');

    const toRecalc = engine.getDependentsToRecalculate(['0:stock']);
    assert.deepEqual(toRecalc, ['0:unit_price', '0:total']);
  });

  it('handles invalid references (#REF!) and division by zero (#DIV/0!)', () => {
    const engine = new FormulaEngine({ columns, rowCount });

    // Reference to non-existent column Z
    const refReg = engine.registerFormula('0:stock', '=Z1*2');
    assert.equal(refReg.ok, false);
    assert.equal(refReg.error, FORMULA_ERRORS.REF);
    assert.equal(engine.evaluate('0:stock', () => 1), FORMULA_ERRORS.REF);

    // Division by zero
    engine.registerFormula('1:stock', '=10/0');
    assert.equal(engine.evaluate('1:stock', () => 1), FORMULA_ERRORS.DIV_ZERO);
  });
});

import { SheetSession } from '../src/engine/sheetSession.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import { pino } from 'pino';

describe('SheetSession Formulas & DAG Recalculation', () => {
  const silentLogger = pino({ level: 'silent' });
  const baseConfig = { SEQUENCER_TICK_MS: 5, PERSIST_DEBOUNCE_MS: 50, PERSIST_MAX_WAIT_MS: 100 };
  const admin = { id: 'admin-1', role: 'ADMIN' };

  const createSession = async () => {
    const store = new MemoryStore();
    const sheet = {
      id: 'test-sheet',
      name: 'Test Sheet',
      rowCount: 10,
      baselineSeq: 0,
      columns: [
        { key: 'cola', label: 'Col A', type: 'integer', confidential: false, staffEditable: true },
        { key: 'colb', label: 'Col B', type: 'integer', confidential: false, staffEditable: true },
        { key: 'colc', label: 'Col C', type: 'integer', confidential: false, staffEditable: true },
      ],
    };
    await store.saveSheet(sheet);
    return SheetSession.open({ sheetId: 'test-sheet', store, config: baseConfig, logger: silentLogger });
  };

  it('evaluates formula on SET and recalculates dependent cells when source cell changes', async () => {
    const session = await createSession();

    // Set A1 (0:cola) = 10, B1 (0:colb) = 20
    await session.submit({
      author: admin,
      ops: [
        { opId: 'op-1', cellId: '0:cola', opType: 'SET', value: 10, vectorClock: {}, lamport: 1, clientTimestamp: 1 },
        { opId: 'op-2', cellId: '0:colb', opType: 'SET', value: 20, vectorClock: {}, lamport: 2, clientTimestamp: 2 },
      ],
    });

    assert.equal(session.snapshot('ADMIN').cells['0:cola'].value, 10);
    assert.equal(session.snapshot('ADMIN').cells['0:colb'].value, 20);

    // Set C1 (0:colc) = =A1*B1
    await session.submit({
      author: admin,
      ops: [
        { opId: 'op-3', cellId: '0:colc', opType: 'SET', value: '=A1*B1', vectorClock: {}, lamport: 3, clientTimestamp: 3 },
      ],
    });

    // C1 should evaluate to 200
    assert.equal(session.snapshot('ADMIN').cells['0:colc'].value, 200);

    // Now update A1 from 10 to 15!
    const committedEvents = [];
    session.on('committed', ({ events }) => committedEvents.push(...events));

    await session.submit({
      author: admin,
      ops: [
        { opId: 'op-4', cellId: '0:cola', opType: 'SET', value: 15, vectorClock: {}, lamport: 4, clientTimestamp: 4 },
      ],
    });

    // A1 is 15, and C1 should have automatically recalculated to 15 * 20 = 300!
    assert.equal(session.snapshot('ADMIN').cells['0:cola'].value, 15);
    assert.equal(session.snapshot('ADMIN').cells['0:colc'].value, 300);

    // Verify recalculation event was emitted for C1
    const recalcEvent = committedEvents.find((e) => e.cellId === '0:colc' && e.value === 300);
    assert.ok(recalcEvent, 'Expected recalculation event for C1 with value 300');

    await session.close();
  });

  it('detects circular references in session and marks cell as #CYCLE!', async () => {
    const session = await createSession();

    // A1 = =B1
    await session.submit({
      author: admin,
      ops: [{ opId: 'c-1', cellId: '0:cola', opType: 'SET', value: '=B1', vectorClock: {}, lamport: 1, clientTimestamp: 1 }],
    });

    // B1 = =A1
    await session.submit({
      author: admin,
      ops: [{ opId: 'c-2', cellId: '0:colb', opType: 'SET', value: '=A1', vectorClock: {}, lamport: 2, clientTimestamp: 2 }],
    });

    // B1 creates a cycle with A1 -> should be #CYCLE!
    assert.equal(session.snapshot('ADMIN').cells['0:colb'].value, '#CYCLE!');

    await session.close();
  });
});
