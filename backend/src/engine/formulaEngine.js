import { columnKeyOf, parseCellId } from '../domain/cellId.js';

export const FORMULA_ERRORS = Object.freeze({
  CYCLE: '#CYCLE!',
  REF: '#REF!',
  DIV_ZERO: '#DIV/0!',
  VALUE: '#VALUE!',
  ERROR: '#ERROR!',
});

/**
 * Converts column letter(s) (e.g. "A", "B", "AA") to 0-based column index.
 */
export function colLettersToIndex(letters) {
  let index = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/**
 * Converts 0-based column index to letter(s) (e.g. 0 -> "A", 25 -> "Z", 26 -> "AA").
 */
export function indexToColLetters(index) {
  let label = '';
  for (let rem = index; rem >= 0; rem = Math.floor(rem / 26) - 1) {
    label = String.fromCharCode(65 + (rem % 26)) + label;
  }
  return label;
}

/**
 * Parses coordinate string like "A1", "B50" to { colIndex, rowIndex }.
 */
export function parseA1Coordinate(coord) {
  const match = /^([A-Z]+)(\d+)$/i.exec(coord.trim());
  if (!match) return null;
  const colIndex = colLettersToIndex(match[1]);
  const rowIndex = parseInt(match[2], 10) - 1;
  if (colIndex < 0 || rowIndex < 0) return null;
  return { colIndex, rowIndex };
}

/**
 * Resolves coordinate to cellId "rowIndex:columnKey".
 */
export function resolveCellId(coord, columns, rowCount) {
  const parsed = parseA1Coordinate(coord);
  if (!parsed) return null;
  const { colIndex, rowIndex } = parsed;
  if (colIndex >= columns.length || rowIndex >= rowCount) return null;
  return `${rowIndex}:${columns[colIndex].key}`;
}

/**
 * Resolves range string like "B2:B50" to an array of cellIds.
 */
export function resolveRangeCellIds(rangeStr, columns, rowCount) {
  const parts = rangeStr.split(':');
  if (parts.length !== 2) return null;
  const start = parseA1Coordinate(parts[0]);
  const end = parseA1Coordinate(parts[1]);
  if (!start || !end) return null;

  const minCol = Math.min(start.colIndex, end.colIndex);
  const maxCol = Math.max(start.colIndex, end.colIndex);
  const minRow = Math.min(start.rowIndex, end.rowIndex);
  const maxRow = Math.max(start.rowIndex, end.rowIndex);

  if (maxCol >= columns.length || maxRow >= rowCount) return null;

  const cellIds = [];
  for (let r = minRow; r <= maxRow; r += 1) {
    for (let c = minCol; c <= maxCol; c += 1) {
      cellIds.push(`${r}:${columns[c].key}`);
    }
  }
  return cellIds;
}

// Tokenizer & Parser for formulas
class Tokenizer {
  constructor(input) {
    this.input = input.trim().replace(/^=/, '');
    this.pos = 0;
  }

  peek() {
    return this.input[this.pos];
  }

  next() {
    return this.input[this.pos++];
  }

  skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos += 1;
    }
  }

  tokenize() {
    const tokens = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.peek();

      // Number
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(this.input[this.pos + 1]))) {
        let numStr = '';
        while (this.pos < this.input.length && (/[\d.]/).test(this.peek())) {
          numStr += this.next();
        }
        tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
        continue;
      }

      // Operators and punctuation
      if ('+-*/^(),:'.includes(ch)) {
        tokens.push({ type: ch, value: ch });
        this.pos += 1;
        continue;
      }

      // Identifiers: cell references (A1), ranges (A1:B10 handled via :), function names (SUM, AVG)
      if (/[A-Za-z]/.test(ch)) {
        let ident = '';
        while (this.pos < this.input.length && /[A-Za-z0-9_]/.test(this.peek())) {
          ident += this.next();
        }
        tokens.push({ type: 'IDENT', value: ident });
        continue;
      }

      // Unknown character
      tokens.push({ type: 'UNKNOWN', value: ch });
      this.pos += 1;
    }
    return tokens;
  }
}

/**
 * Recursive descent parser for formula expressions.
 */
class FormulaParser {
  constructor(tokens, columns, rowCount) {
    this.tokens = tokens;
    this.columns = columns;
    this.rowCount = rowCount;
    this.pos = 0;
    this.referencedCellIds = new Set();
    this.hasRefError = false;
  }

  peek() {
    return this.tokens[this.pos] || { type: 'EOF' };
  }

  match(...types) {
    const token = this.peek();
    if (types.includes(token.type)) {
      this.pos += 1;
      return token;
    }
    return null;
  }

  parse() {
    const expr = this.parseExpression();
    if (this.peek().type !== 'EOF') {
      return { error: FORMULA_ERRORS.ERROR };
    }
    return expr;
  }

  parseExpression() {
    return this.parseAddSub();
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    let op;
    while ((op = this.match('+', '-'))) {
      const right = this.parseMulDiv();
      left = { type: 'binary', op: op.value, left, right };
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parsePower();
    let op;
    while ((op = this.match('*', '/'))) {
      const right = this.parsePower();
      left = { type: 'binary', op: op.value, left, right };
    }
    return left;
  }

  parsePower() {
    let left = this.parseUnary();
    let op;
    while ((op = this.match('^'))) {
      const right = this.parsePower(); // right-associative
      left = { type: 'binary', op: op.value, left, right };
    }
    return left;
  }

  parseUnary() {
    const op = this.match('-', '+');
    if (op) {
      const expr = this.parseUnary();
      return { type: 'unary', op: op.value, expr };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();

    if (this.match('(')) {
      const expr = this.parseExpression();
      if (!this.match(')')) {
        return { error: FORMULA_ERRORS.ERROR };
      }
      return expr;
    }

    if (token.type === 'NUMBER') {
      this.pos += 1;
      return { type: 'number', value: token.value };
    }

    if (token.type === 'IDENT') {
      this.pos += 1;
      const ident = token.value.toUpperCase();

      // Check if this is a function call: IDENT followed by '('
      if (this.peek().type === '(') {
        this.match('(');
        const args = [];
        if (!this.match(')')) {
          while (true) {
            args.push(this.parseArgument());
            if (this.match(',')) continue;
            if (this.match(')')) break;
            return { error: FORMULA_ERRORS.ERROR };
          }
        }
        return { type: 'call', fn: ident, args };
      }

      // Check if this is a range: IDENT : IDENT (e.g. B2:B50)
      if (this.peek().type === ':') {
        this.match(':');
        const next = this.match('IDENT');
        if (!next) return { error: FORMULA_ERRORS.REF };
        const rangeStr = `${ident}:${next.value.toUpperCase()}`;
        const cellIds = resolveRangeCellIds(rangeStr, this.columns, this.rowCount);
        if (!cellIds) {
          this.hasRefError = true;
          return { error: FORMULA_ERRORS.REF };
        }
        for (const id of cellIds) this.referencedCellIds.add(id);
        return { type: 'range', rangeStr, cellIds };
      }

      // Single cell coordinate: e.g. A1, C2
      const cellId = resolveCellId(ident, this.columns, this.rowCount);
      if (!cellId) {
        this.hasRefError = true;
        return { error: FORMULA_ERRORS.REF };
      }
      this.referencedCellIds.add(cellId);
      return { type: 'cell', coord: ident, cellId };
    }

    return { error: FORMULA_ERRORS.ERROR };
  }

  parseArgument() {
    // Arguments in function calls can be ranges like A1:A10, expressions, or numbers
    const token = this.peek();
    if (token.type === 'IDENT' && this.tokens[this.pos + 1]?.type === ':') {
      this.pos += 1;
      this.pos += 1; // skip ':'
      const endToken = this.match('IDENT');
      if (!endToken) return { error: FORMULA_ERRORS.REF };
      const rangeStr = `${token.value.toUpperCase()}:${endToken.value.toUpperCase()}`;
      const cellIds = resolveRangeCellIds(rangeStr, this.columns, this.rowCount);
      if (!cellIds) {
        this.hasRefError = true;
        return { error: FORMULA_ERRORS.REF };
      }
      for (const id of cellIds) this.referencedCellIds.add(id);
      return { type: 'range', rangeStr, cellIds };
    }
    return this.parseExpression();
  }
}

/**
 * Evaluates an AST against cell values retrieved via getCellValue.
 */
function evaluateAst(node, getCellValue) {
  if (!node) return FORMULA_ERRORS.ERROR;
  if (node.error) return node.error;

  switch (node.type) {
    case 'number':
      return node.value;

    case 'cell': {
      const raw = getCellValue(node.cellId);
      if (raw === null || raw === undefined || raw === '') return 0;
      if (typeof raw === 'string') {
        if (Object.values(FORMULA_ERRORS).includes(raw)) return raw;
        const num = parseFloat(raw.replace(/[$,%\s]/g, ''));
        return Number.isFinite(num) ? num : FORMULA_ERRORS.VALUE;
      }
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : FORMULA_ERRORS.VALUE;
    }

    case 'unary': {
      const val = evaluateAst(node.expr, getCellValue);
      if (typeof val === 'string' && Object.values(FORMULA_ERRORS).includes(val)) return val;
      return node.op === '-' ? -Number(val) : Number(val);
    }

    case 'binary': {
      const left = evaluateAst(node.left, getCellValue);
      if (typeof left === 'string' && Object.values(FORMULA_ERRORS).includes(left)) return left;
      const right = evaluateAst(node.right, getCellValue);
      if (typeof right === 'string' && Object.values(FORMULA_ERRORS).includes(right)) return right;

      const numLeft = Number(left);
      const numRight = Number(right);
      if (!Number.isFinite(numLeft) || !Number.isFinite(numRight)) return FORMULA_ERRORS.VALUE;

      switch (node.op) {
        case '+': return numLeft + numRight;
        case '-': return numLeft - numRight;
        case '*': return numLeft * numRight;
        case '/':
          if (numRight === 0) return FORMULA_ERRORS.DIV_ZERO;
          return numLeft / numRight;
        case '^': return numLeft ** numRight;
        default: return FORMULA_ERRORS.ERROR;
      }
    }

    case 'call': {
      const values = [];
      for (const arg of node.args) {
        if (arg.type === 'range') {
          for (const cellId of arg.cellIds) {
            const raw = getCellValue(cellId);
            if (typeof raw === 'string' && Object.values(FORMULA_ERRORS).includes(raw)) return raw;
            if (raw !== null && raw !== undefined && raw !== '') {
              const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,%\s]/g, ''));
              if (Number.isFinite(num)) values.push(num);
            }
          }
        } else {
          const val = evaluateAst(arg, getCellValue);
          if (typeof val === 'string' && Object.values(FORMULA_ERRORS).includes(val)) return val;
          const num = Number(val);
          if (Number.isFinite(num)) values.push(num);
        }
      }

      switch (node.fn) {
        case 'SUM':
          return values.reduce((acc, v) => acc + v, 0);
        case 'AVG':
        case 'AVERAGE':
          return values.length === 0 ? 0 : values.reduce((acc, v) => acc + v, 0) / values.length;
        case 'MIN':
          return values.length === 0 ? 0 : Math.min(...values);
        case 'MAX':
          return values.length === 0 ? 0 : Math.max(...values);
        case 'COUNT':
          return values.length;
        default:
          return FORMULA_ERRORS.ERROR;
      }
    }

    default:
      return FORMULA_ERRORS.ERROR;
  }
}

/**
 * Dependency Tracker and Formula Evaluator DAG.
 */
export class FormulaEngine {
  #columns = [];
  #rowCount = 0;
  // cellId -> { rawFormula: string, ast: object, referencedCellIds: Set<string> }
  #formulas = new Map();
  // cellId -> Set<cellId> (dependencies: cells this cell depends on)
  #dependencies = new Map();
  // cellId -> Set<cellId> (dependents: cells that depend on this cell)
  #dependents = new Map();

  constructor({ columns = [], rowCount = 0 } = {}) {
    this.#columns = columns;
    this.#rowCount = rowCount;
  }

  updateSchema(columns, rowCount) {
    this.#columns = columns;
    this.#rowCount = rowCount;
  }

  hasFormula(cellId) {
    return this.#formulas.has(cellId);
  }

  getFormula(cellId) {
    return this.#formulas.get(cellId)?.rawFormula ?? null;
  }

  /**
   * Registers a formula for cellId, checks for circular dependencies.
   * Returns { ok: true, ast } or { ok: false, error: '#CYCLE!' | '#REF!' }.
   */
  registerFormula(cellId, rawFormula) {
    const tokens = new Tokenizer(rawFormula).tokenize();
    const parser = new FormulaParser(tokens, this.#columns, this.#rowCount);
    const ast = parser.parse();

    if (parser.hasRefError || ast?.error === FORMULA_ERRORS.REF) {
      this.clearFormula(cellId);
      this.#formulas.set(cellId, { rawFormula, ast: { error: FORMULA_ERRORS.REF }, referencedCellIds: new Set() });
      return { ok: false, error: FORMULA_ERRORS.REF };
    }

    if (ast?.error) {
      this.clearFormula(cellId);
      this.#formulas.set(cellId, { rawFormula, ast, referencedCellIds: new Set() });
      return { ok: false, error: ast.error };
    }

    // Check circular references
    if (this.#wouldCreateCycle(cellId, parser.referencedCellIds)) {
      this.clearFormula(cellId);
      this.#formulas.set(cellId, { rawFormula, ast: { error: FORMULA_ERRORS.CYCLE }, referencedCellIds: new Set() });
      return { ok: false, error: FORMULA_ERRORS.CYCLE };
    }

    // Valid formula: update dependency graph
    this.clearFormula(cellId);
    this.#formulas.set(cellId, { rawFormula, ast, referencedCellIds: parser.referencedCellIds });
    this.#dependencies.set(cellId, new Set(parser.referencedCellIds));

    for (const depId of parser.referencedCellIds) {
      if (!this.#dependents.has(depId)) this.#dependents.set(depId, new Set());
      this.#dependents.get(depId).add(cellId);
    }

    return { ok: true, ast };
  }

  clearFormula(cellId) {
    const existing = this.#formulas.get(cellId);
    if (!existing) return;

    const oldDeps = this.#dependencies.get(cellId);
    if (oldDeps) {
      for (const depId of oldDeps) {
        this.#dependents.get(depId)?.delete(cellId);
      }
      this.#dependencies.delete(cellId);
    }
    this.#formulas.delete(cellId);
  }

  /**
   * Checks if adding edges from cellId to targetDeps would form a cycle.
   */
  #wouldCreateCycle(cellId, targetDeps) {
    if (targetDeps.has(cellId)) return true;

    // DFS to check if cellId is reachable from any dep in targetDeps
    const visited = new Set();
    const dfs = (current) => {
      if (current === cellId) return true;
      visited.add(current);
      const deps = this.#dependencies.get(current);
      if (!deps) return false;
      for (const next of deps) {
        if (!visited.has(next)) {
          if (dfs(next)) return true;
        }
      }
      return false;
    };

    for (const dep of targetDeps) {
      if (dfs(dep)) return true;
    }
    return false;
  }

  /**
   * Evaluates the formula for cellId using the given cell value lookup function.
   */
  evaluate(cellId, getCellValue) {
    const entry = this.#formulas.get(cellId);
    if (!entry) return null;
    const result = evaluateAst(entry.ast, getCellValue);
    if (typeof result === 'number' && Number.isFinite(result)) {
      return Math.round(result * 10000) / 10000;
    }
    return result;
  }

  /**
   * Given an array of changed cellIds, returns all dependent cells to recalculate
   * in topological order.
   */
  getDependentsToRecalculate(changedCellIds) {
    const affected = new Set();
    const queue = [...changedCellIds];

    while (queue.length > 0) {
      const current = queue.shift();
      const deps = this.#dependents.get(current);
      if (deps) {
        for (const dep of deps) {
          if (!affected.has(dep)) {
            affected.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    if (affected.size === 0) return [];

    // Topological sort of affected nodes
    const inDegree = new Map();
    for (const node of affected) {
      const nodeDeps = this.#dependencies.get(node) || new Set();
      let count = 0;
      for (const d of nodeDeps) {
        if (affected.has(d)) count += 1;
      }
      inDegree.set(node, count);
    }

    const topoOrder = [];
    const ready = [];
    for (const [node, deg] of inDegree) {
      if (deg === 0) ready.push(node);
    }

    while (ready.length > 0) {
      const node = ready.shift();
      topoOrder.push(node);

      const dependents = this.#dependents.get(node);
      if (dependents) {
        for (const dep of dependents) {
          if (affected.has(dep)) {
            const nextDeg = inDegree.get(dep) - 1;
            inDegree.set(dep, nextDeg);
            if (nextDeg === 0) ready.push(dep);
          }
        }
      }
    }

    return topoOrder;
  }
}

