import { isNumericColumn } from './format.js';

const ok = (value) => ({ ok: true, value });
const fail = (message) => ({ ok: false, message });

/** Mirrors server-side normalisation closely enough to give instant feedback; the server remains authoritative. */
export function parseCellInput(column, rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : rawInput;
  if (text === null || text === undefined || text === '') {
    return column.required ? fail(`${column.label} is required`) : ok(null);
  }
  if (typeof text === 'string' && text.startsWith('=')) {
    return ok(text);
  }
  if (isNumericColumn(column)) {
    const numeric = typeof text === 'number' ? text : Number(String(text).replace(/[$,%\s]/g, ''));
    if (!Number.isFinite(numeric)) return fail(`${column.label} must be a number`);
    if (column.type === 'integer' && !Number.isInteger(numeric)) return fail(`${column.label} must be a whole number`);
    if (column.min !== undefined && numeric < column.min) return fail(`${column.label} must be at least ${column.min}`);
    if (column.max !== undefined && numeric > column.max) return fail(`${column.label} must be at most ${column.max}`);
    return ok(numeric);
  }
  if (column.type === 'select' && !column.options?.includes(text)) {
    return fail(`${column.label} must be one of: ${column.options?.join(', ')}`);
  }
  return ok(String(text));
}
