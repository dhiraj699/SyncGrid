import { Eye, Lock } from 'lucide-react';
import { columnLetter } from '../../domain/cellId.js';

export function ColumnHeader({ column, index, canEditSchema, onToggleConfidential }) {
  const { canRead, canWrite } = column.permissionMask;

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-r border-slate-800 px-2" style={{ width: column.width }}>
      <span className="font-mono text-[10px] text-slate-500">{columnLetter(index)}</span>
      <span className="truncate text-[12px] font-medium text-slate-200">{column.label}</span>
      <span className="ml-auto flex items-center gap-1">
        {canRead && !canWrite && (
          <span title="Read-only for your role" className="text-slate-500"><Eye size={11} /></span>
        )}
        {canEditSchema ? (
          <button
            type="button"
            onClick={() => onToggleConfidential(column)}
            title={column.confidential ? 'Confidential — click to declassify' : 'Click to mark as confidential'}
            className={`rounded p-0.5 transition-colors hover:bg-slate-800 ${column.confidential ? 'text-amber-400' : 'text-slate-700 hover:text-slate-400'}`}
          >
            <Lock size={11} />
          </button>
        ) : (
          column.confidential && <span title="Confidential" className="text-amber-500/80"><Lock size={11} /></span>
        )}
      </span>
    </div>
  );
}
