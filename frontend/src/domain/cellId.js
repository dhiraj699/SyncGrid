export const formatCellId = (rowIndex, columnKey) => `${rowIndex}:${columnKey}`;

export function parseCellId(cellId) {
  const separator = cellId.indexOf(':');
  return { rowIndex: Number(cellId.slice(0, separator)), columnKey: cellId.slice(separator + 1) };
}

export function columnLetter(index) {
  let label = '';
  for (let remaining = index; remaining >= 0; remaining = Math.floor(remaining / 26) - 1) {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
  }
  return label;
}

export const toCoordinate = (rowIndex, columnIndex) => `${columnLetter(columnIndex)}${rowIndex + 1}`;

export function coordinateOf(cellId, columns) {
  const { rowIndex, columnKey } = parseCellId(cellId);
  const columnIndex = columns.findIndex((column) => column.key === columnKey);
  return columnIndex < 0 ? cellId : toCoordinate(rowIndex, columnIndex);
}
