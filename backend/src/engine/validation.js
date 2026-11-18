const TEXT_MAX_LENGTH = 500;
const patternCache = new Map();

const compilePattern = (source) => {
  if (!patternCache.has(source)) patternCache.set(source, new RegExp(source));
  return patternCache.get(source);
};

const accept = (value) => ({ ok: true, value });
const reject = (message) => ({ ok: false, message });

function parseNumber(rawValue) {
  if (typeof rawValue === 'number') return rawValue;
  const sanitized = String(rawValue).replace(/[$,%\s]/g, '');
  return sanitized === '' ? Number.NaN : Number(sanitized);
}

/**
 * Coerces a raw payload value into the column's canonical type, or explains why it cannot.
 * Empty input clears the cell, which is only legal for non-required columns.
 */
export function normalizeValue(column, rawValue) {
  const isEmpty = rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '');
  if (isEmpty) return column.required ? reject(`${column.label} is required`) : accept(null);

  if (typeof rawValue === 'string' && rawValue.trim().startsWith('=')) {
    return accept(rawValue.trim());
  }

  switch (column.type) {
    case 'text': {
      const text = String(rawValue).trim();
      if (text.length > TEXT_MAX_LENGTH) return reject(`${column.label} exceeds ${TEXT_MAX_LENGTH} characters`);
      if (column.pattern && !compilePattern(column.pattern).test(text)) {
        return reject(`${column.label} does not match the expected format`);
      }
      return accept(text);
    }
    case 'select': {
      const choice = String(rawValue).trim();
      return column.options?.includes(choice) ? accept(choice) : reject(`${column.label} must be one of: ${column.options?.join(', ')}`);
    }
    case 'integer':
    case 'number':
    case 'currency':
    case 'percent': {
      const numeric = parseNumber(rawValue);
      if (!Number.isFinite(numeric)) return reject(`${column.label} must be a number`);
      if (column.type === 'integer' && !Number.isInteger(numeric)) return reject(`${column.label} must be a whole number`);
      if (column.min !== undefined && numeric < column.min) return reject(`${column.label} must be at least ${column.min}`);
      if (column.max !== undefined && numeric > column.max) return reject(`${column.label} must be at most ${column.max}`);
      return accept(column.type === 'currency' ? Math.round(numeric * 100) / 100 : numeric);
    }
    default:
      return reject(`Unsupported column type: ${column.type}`);
  }
}
