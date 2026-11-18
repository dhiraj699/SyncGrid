import { Router } from 'express';
import { Permission } from '../../../domain/access.js';
import { columnPatchSchema, historyQuerySchema, sheetIdSchema } from '../../schemas.js';
import { HttpError } from '../httpError.js';
import { asyncHandler, authenticate, requirePermission } from '../middleware.js';

export function createSheetsRouter({ authService, registry, history, store }) {
  const router = Router();
  router.use(authenticate(authService));

  router.get('/', asyncHandler(async (_req, res) => res.json({ sheets: await store.listSheets() })));

  router.get('/:sheetId', asyncHandler(async (req, res) => {
    const session = await registry.get(sheetIdSchema.parse(req.params.sheetId));
    res.json(session.snapshot(req.user.role));
  }));

  router.get('/:sheetId/export', asyncHandler(async (req, res) => {
    const sheetId = sheetIdSchema.parse(req.params.sheetId);
    const session = await registry.get(sheetId);
    const snapshot = session.snapshot(req.user.role);

    const columns = snapshot.sheet.columns;
    const header = columns.map((col) => `"${col.label.replace(/"/g, '""')}"`).join(',');
    const rows = [header];

    for (let rowIndex = 0; rowIndex < snapshot.sheet.rowCount; rowIndex += 1) {
      const rowValues = [];
      for (const col of columns) {
        const cellId = `${rowIndex}:${col.key}`;
        const cell = snapshot.cells[cellId];
        const val = cell ? cell.value : '';
        if (val === null || val === undefined) {
          rowValues.push('""');
        } else if (typeof val === 'number') {
          rowValues.push(String(val));
        } else {
          rowValues.push(`"${String(val).replace(/"/g, '""')}"`);
        }
      }
      rows.push(rowValues.join(','));
    }

    const csvData = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sheetId}.csv"`);
    res.status(200).send(csvData);
  }));

  router.get('/:sheetId/history/baseline', requirePermission(Permission.AUDIT_READ), asyncHandler(async (req, res) => {
    res.json(await history.baseline(sheetIdSchema.parse(req.params.sheetId), req.user.role));
  }));

  router.get('/:sheetId/history/events', requirePermission(Permission.AUDIT_READ), asyncHandler(async (req, res) => {
    const query = historyQuerySchema.parse(req.query);
    res.json(await history.events(sheetIdSchema.parse(req.params.sheetId), req.user.role, query));
  }));

  router.patch('/:sheetId/columns/:columnKey', requirePermission(Permission.SCHEMA_WRITE), asyncHandler(async (req, res) => {
    const session = await registry.get(sheetIdSchema.parse(req.params.sheetId));
    const column = await session.updateColumn(req.params.columnKey, columnPatchSchema.parse(req.body));
    if (!column) throw new HttpError(404, 'UNKNOWN_COLUMN', 'Column does not exist');
    res.json({ column });
  }));

  return router;
}
