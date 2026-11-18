const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatCellValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  switch (column.type) {
    case 'currency': return currency.format(value);
    case 'percent': return `${Number(value).toFixed(1)}%`;
    case 'integer': return integer.format(value);
    default: return String(value);
  }
}

export const isNumericColumn = (column) => ['integer', 'number', 'currency', 'percent'].includes(column.type);
export const toEditableText = (value) => (value === null || value === undefined ? '' : String(value));
