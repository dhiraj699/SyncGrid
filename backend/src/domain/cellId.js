export const CELL_ID_PATTERN = /^(\d{1,6}):([a-z][a-z0-9_]{0,39})$/;

export function parseCellId(cellId) {
  const match = CELL_ID_PATTERN.exec(cellId);
  return match ? { rowIndex: Number(match[1]), columnKey: match[2] } : null;
}

export const columnKeyOf = (cellId) => cellId.slice(cellId.indexOf(':') + 1);
