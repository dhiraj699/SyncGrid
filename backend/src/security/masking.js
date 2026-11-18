import { permissionMaskFor } from '../domain/access.js';
import { columnKeyOf } from '../domain/cellId.js';

export const MASK_PLACEHOLDER = '••••';

export const toWireCell = (stateOrValue, mask) => {
  if (!mask.canRead) {
    return { value: MASK_PLACEHOLDER, isMasked: true, locked: true };
  }
  if (stateOrValue !== null && typeof stateOrValue === 'object' && 'value' in stateOrValue) {
    const wire = { value: stateOrValue.value, isMasked: false, locked: !mask.canWrite };
    if (stateOrValue.authorId) wire.authorId = stateOrValue.authorId;
    if (stateOrValue.authorName) wire.authorName = stateOrValue.authorName;
    if (stateOrValue.authorRole) wire.authorRole = stateOrValue.authorRole;
    if (stateOrValue.revision) wire.revision = stateOrValue.revision;
    if (stateOrValue.timestamp) wire.timestamp = stateOrValue.timestamp;
    if (stateOrValue.formula) wire.formula = stateOrValue.formula;
    return wire;
  }
  return { value: stateOrValue, isMasked: false, locked: !mask.canWrite };
};

export const projectColumns = (columns, role) =>
  columns.map((column) => ({ ...column, permissionMask: permissionMaskFor(role, column) }));

export const projectSheet = (sheet, role) => ({
  id: sheet.id,
  name: sheet.name,
  rowCount: sheet.rowCount,
  baselineSeq: sheet.baselineSeq,
  columns: projectColumns(sheet.columns, role),
});

/**
 * Rewrites an event for a role. Restricted roles never receive the real value
 * or previous value, and cannot distinguish a clear from an edit.
 */
export function projectEvent(event, columnsByKey, role) {
  const column = columnsByKey.get(columnKeyOf(event.cellId));
  const canRead = column ? permissionMaskFor(role, column).canRead : false;
  if (canRead) return { ...event, isMasked: false };
  const { formula, ...rest } = event;
  return { ...rest, value: MASK_PLACEHOLDER, previousValue: MASK_PLACEHOLDER, isMasked: true };
}
