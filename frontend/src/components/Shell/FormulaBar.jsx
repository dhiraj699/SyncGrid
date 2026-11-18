import { Lock, Redo2, Undo2 } from 'lucide-react';
import { formatCellValue } from '../../domain/format.js';

export function FormulaBar({ coordinate, column, payload, readOnly, canUndo, canRedo, onUndo, onRedo }) {
  const masked = Boolean(payload?.isMasked) || (column && !column.permissionMask.canRead);
  const displayed = masked ? '••••' : payload?.formula ? payload.formula : column ? formatCellValue(column, payload?.value) : '';

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-950 px-3">
      <span className="w-14 rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-center font-mono text-[11.5px] tabular-nums text-sky-300">{coordinate}</span>
      <span className="w-28 truncate text-[12px] text-slate-500">{column?.label}</span>
      <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded border border-slate-800 bg-slate-900/60 px-2 text-[12.5px] tabular-nums text-slate-200">
        {masked && <Lock size={11} className="text-slate-500" />}
        <span className="truncate">{displayed}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <button type="button" disabled={readOnly || !canUndo} onClick={onUndo} title="Undo (Ctrl+Z)" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"><Undo2 size={14} /></button>
        <button type="button" disabled={readOnly || !canRedo} onClick={onRedo} title="Redo (Ctrl+Y)" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"><Redo2 size={14} /></button>
      </div>
    </div>
  );
}
