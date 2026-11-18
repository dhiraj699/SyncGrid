import { Lock } from 'lucide-react';
import { memo } from 'react';
import { formatCellValue, isNumericColumn } from '../../domain/format.js';
import { GUTTER_WIDTH, ROW_HEIGHT } from './metrics.js';

const STATUS_STYLES = {
  'In stock': 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  'Low stock': 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
  Backordered: 'bg-rose-400/10 text-rose-300 ring-rose-400/25',
  Discontinued: 'bg-slate-400/10 text-slate-400 ring-slate-400/20',
};

const sameItems = (left, right, itemsEqual = Object.is) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!itemsEqual(left[index], right[index])) return false;
  }
  return true;
};

const sameRemote = (left, right) => (left === undefined || right === undefined ? left === right : sameItems(left, right));

const rowPropsEqual = (previous, next) =>
  previous.rowIndex === next.rowIndex &&
  previous.top === next.top &&
  previous.columns === next.columns &&
  previous.selectedCol === next.selectedCol &&
  previous.editing === next.editing &&
  previous.readOnly === next.readOnly &&
  previous.handlers === next.handlers &&
  sameItems(previous.payloads, next.payloads) &&
  sameItems(previous.remote, next.remote, sameRemote) &&
  sameItems(previous.marks, next.marks);

function CellValue({ column, payload, masked }) {
  if (masked) {
    return (
      <span className="flex items-center gap-1 font-mono text-[11px] tracking-widest text-slate-500">
        <Lock size={9} />••••
      </span>
    );
  }
  const text = formatCellValue(column, payload?.value);
  if (column.key === 'status' && text) {
    return <span className={`rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLES[text] ?? STATUS_STYLES.Discontinued}`}>{text}</span>;
  }
  return <span className="truncate">{text}</span>;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function cellAuditTooltip(payload, masked) {
  if (masked) return 'Confidential column (masked for Staff)';
  if (!payload) return undefined;
  const parts = [];
  if (payload.authorName || payload.authorRole || payload.authorId) {
    const authorStr = payload.authorName || (payload.authorRole
      ? payload.authorRole.charAt(0).toUpperCase() + payload.authorRole.slice(1).toLowerCase()
      : payload.authorId);
    parts.push(`Last edited by ${authorStr}`);
  }
  if (payload.timestamp) {
    const rel = formatRelativeTime(payload.timestamp);
    if (rel) parts.push(rel);
  }
  if (payload.revision) {
    parts.push(`v${payload.revision}`);
  }
  if (payload.formula) {
    parts.push(`fx: ${payload.formula}`);
  }
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

export const GridRow = memo(function GridRow({ rowIndex, top, columns, payloads, selectedCol, editing, remote, marks, readOnly, handlers }) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      className="absolute left-0 flex hover:bg-slate-900/60"
      style={{ top, height: ROW_HEIGHT }}
      onMouseDown={(event) => {
        const cell = event.target.closest('[data-col]');
        if (cell) handlers.onCellMouseDown(rowIndex, Number(cell.dataset.col));
      }}
      onDoubleClick={(event) => {
        const cell = event.target.closest('[data-col]');
        if (cell) handlers.onCellDoubleClick(rowIndex, Number(cell.dataset.col));
      }}
    >
      <div
        className={`sticky left-0 z-20 flex shrink-0 items-center justify-end border-b border-r border-slate-700 pr-2 font-mono text-[11px] tabular-nums ${selectedCol >= 0 ? 'bg-slate-800 text-sky-300' : 'bg-slate-900 text-slate-500'}`}
        style={{ width: GUTTER_WIDTH }}
      >
        {rowIndex + 1}
      </div>

      {columns.map((column, colIndex) => {
        const payload = payloads[colIndex];
        const masked = Boolean(payload?.isMasked) || !column.permissionMask.canRead;
        const isSelected = colIndex === selectedCol;
        const isEditing = editing?.colIndex === colIndex;
        const mark = marks[colIndex];
        const cellRemote = remote[colIndex];
        const numeric = isNumericColumn(column);

        return (
          <div
            key={column.key}
            role="gridcell"
            aria-selected={isSelected}
            data-col={colIndex}
            title={cellAuditTooltip(payload, masked)}
            className={[
              'relative flex shrink-0 items-center border-b border-r border-slate-800/80 px-2 text-[12.5px]',
              numeric ? 'justify-end tabular-nums' : '',
              masked ? 'masked-cell' : column.permissionMask.canWrite ? 'text-slate-200' : 'text-slate-400',
              isSelected ? 'z-10 bg-sky-400/[0.06] outline outline-2 -outline-offset-2 outline-sky-400' : '',
            ].join(' ')}
            style={{
              width: column.width,
              ...(mark ? { backgroundColor: `${mark.color}26`, boxShadow: `inset 3px 0 0 ${mark.color}` } : null),
            }}
          >
            {isEditing ? (
              <input
                autoFocus
                value={editing.draft}
                list={column.type === 'select' ? `options-${column.key}` : undefined}
                inputMode={numeric ? 'decimal' : undefined}
                spellCheck={false}
                onChange={(event) => handlers.onDraftChange(event.target.value)}
                onBlur={handlers.onEditBlur}
                onFocus={(event) => event.target.setSelectionRange(event.target.value.length, event.target.value.length)}
                className={`absolute inset-0 z-20 w-full bg-slate-950 px-2 text-[12.5px] text-slate-50 outline outline-2 -outline-offset-2 outline-sky-400 ${numeric ? 'text-right tabular-nums' : ''}`}
              />
            ) : (
              <CellValue column={column} payload={payload} masked={masked} />
            )}

            {payload?.pending && <span title="Syncing" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />}

            {cellRemote?.map((peer, peerIndex) => (
              <span key={peer.socketId} className="pointer-events-none absolute inset-0 z-20 border-2" style={{ borderColor: peer.color }}>
                <span
                  className="absolute -top-[15px] rounded-sm px-1 text-[10px] font-semibold leading-[14px] text-slate-950"
                  style={{ backgroundColor: peer.color, right: peerIndex * 22 - 2 }}
                >
                  {peer.initials}
                </span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}, rowPropsEqual);
