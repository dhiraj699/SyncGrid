import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCellId } from '../../domain/cellId.js';
import { toEditableText } from '../../domain/format.js';
import { ColumnHeader } from './ColumnHeader.jsx';
import { GridRow } from './GridRow.jsx';
import { GUTTER_WIDTH, HEADER_HEIGHT, OVERSCAN_ROWS, ROW_HEIGHT } from './metrics.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/**
 * Row-virtualised grid. Only rows inside the viewport plus a 5-row buffer are
 * mounted, and each mounted row is memoised on the identity of its cell
 * payloads, so a remote edit re-renders one row rather than the viewport.
 */
export function DataGrid({
  columns, rowCount, cells, overlay, readOnly, selection, onSelectionChange,
  presenceByCell, decorations, onCommit, onUndo, onRedo, canEditSchema, onToggleConfidential,
}) {
  const scrollRef = useRef(null);
  const editingRef = useRef(null);
  const [editing, setEditingState] = useState(null);

  const setEditing = (next) => {
    editingRef.current = next;
    setEditingState(next);
  };

  const columnOffsets = useMemo(() => {
    let cursor = GUTTER_WIDTH;
    return columns.map((column) => {
      const left = cursor;
      cursor += column.width;
      return left;
    });
  }, [columns]);
  const totalWidth = columns.length ? columnOffsets.at(-1) + columns.at(-1).width : GUTTER_WIDTH;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !selection) return;
    const rowTop = HEADER_HEIGHT + selection.row * ROW_HEIGHT;
    if (rowTop < element.scrollTop + HEADER_HEIGHT) element.scrollTop = rowTop - HEADER_HEIGHT;
    else if (rowTop + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = rowTop + ROW_HEIGHT - element.clientHeight;

    const left = columnOffsets[selection.col];
    const right = left + columns[selection.col].width;
    if (left < element.scrollLeft + GUTTER_WIDTH) element.scrollLeft = left - GUTTER_WIDTH;
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  }, [selection?.row, selection?.col]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing) scrollRef.current?.focus({ preventScroll: true });
  }, [editing === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveSelection = (rowDelta, columnDelta) => {
    const origin = selection ?? { row: 0, col: 0 };
    onSelectionChange({
      row: clamp(origin.row + rowDelta, 0, rowCount - 1),
      col: clamp(origin.col + columnDelta, 0, columns.length - 1),
    });
  };

  const beginEdit = (target, initialDraft) => {
    if (readOnly || !target) return;
    const column = columns[target.col];
    if (!column.permissionMask.canWrite) return;
    const cellId = formatCellId(target.row, column.key);
    const payload = overlay?.[cellId] ?? cells[cellId];
    setEditing({ cellId, rowIndex: target.row, colIndex: target.col, draft: initialDraft ?? (payload?.formula ?? toEditableText(payload?.value)) });
  };

  const finishEdit = (commit, rowDelta = 0, columnDelta = 0) => {
    const active = editingRef.current;
    if (!active) return;
    setEditing(null);
    if (commit) onCommit(active.cellId, active.draft);
    if (rowDelta || columnDelta) moveSelection(rowDelta, columnDelta);
  };

  const handleKeyDown = (event) => {
    if (editingRef.current) {
      if (event.key === 'Enter') { event.preventDefault(); finishEdit(true, event.shiftKey ? -1 : 1, 0); }
      else if (event.key === 'Tab') { event.preventDefault(); finishEdit(true, 0, event.shiftKey ? -1 : 1); }
      else if (event.key === 'Escape') { event.preventDefault(); finishEdit(false); }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); if (!readOnly) onUndo(); }
      else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); if (!readOnly) onRedo(); }
      return;
    }

    const pageRows = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 2);
    switch (event.key) {
      case 'ArrowUp': event.preventDefault(); moveSelection(-1, 0); break;
      case 'ArrowDown': event.preventDefault(); moveSelection(1, 0); break;
      case 'ArrowLeft': event.preventDefault(); moveSelection(0, -1); break;
      case 'ArrowRight': event.preventDefault(); moveSelection(0, 1); break;
      case 'Tab': event.preventDefault(); moveSelection(0, event.shiftKey ? -1 : 1); break;
      case 'PageDown': event.preventDefault(); moveSelection(pageRows, 0); break;
      case 'PageUp': event.preventDefault(); moveSelection(-pageRows, 0); break;
      case 'Home': event.preventDefault(); moveSelection(0, -columns.length); break;
      case 'End': event.preventDefault(); moveSelection(0, columns.length); break;
      case 'Enter':
      case 'F2': event.preventDefault(); beginEdit(selection); break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (!readOnly && selection) onCommit(formatCellId(selection.row, columns[selection.col].key), null);
        break;
      default:
        if (event.key.length === 1 && !event.altKey) { event.preventDefault(); beginEdit(selection, event.key); }
    }
  };

  const latest = useRef();
  latest.current = { onSelectionChange, beginEdit, finishEdit };
  const handlers = useMemo(() => ({
    onCellMouseDown: (row, col) => latest.current.onSelectionChange({ row, col }),
    onCellDoubleClick: (row, col) => latest.current.beginEdit({ row, col }),
    onDraftChange: (draft) => setEditing({ ...editingRef.current, draft }),
    onEditBlur: () => latest.current.finishEdit(true),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={scrollRef}
      role="grid"
      tabIndex={0}
      aria-rowcount={rowCount + 1}
      aria-colcount={columns.length}
      aria-readonly={readOnly}
      onKeyDown={handleKeyDown}
      className="relative h-full w-full overflow-auto bg-slate-950 outline-none"
    >
      <div className="relative" style={{ height: HEADER_HEIGHT + virtualizer.getTotalSize(), width: totalWidth }}>
        <div role="row" className="sticky top-0 z-30 flex border-b border-slate-700 bg-slate-900" style={{ height: HEADER_HEIGHT, width: totalWidth }}>
          <div className="sticky left-0 z-40 flex shrink-0 items-center justify-end border-r border-slate-700 bg-slate-900 pr-2 font-mono text-[10px] text-slate-600" style={{ width: GUTTER_WIDTH }}>#</div>
          {columns.map((column, index) => (
            <ColumnHeader key={column.key} column={column} index={index} canEditSchema={canEditSchema} onToggleConfidential={onToggleConfidential} />
          ))}
        </div>

        {virtualizer.getVirtualItems().map((item) => {
          const rowIndex = item.index;
          const payloads = new Array(columns.length);
          const remote = new Array(columns.length);
          const marks = new Array(columns.length);
          for (let col = 0; col < columns.length; col += 1) {
            const cellId = formatCellId(rowIndex, columns[col].key);
            payloads[col] = overlay?.[cellId] ?? cells[cellId];
            remote[col] = presenceByCell.get(cellId);
            marks[col] = decorations?.get(cellId);
          }
          return (
            <GridRow
              key={rowIndex}
              rowIndex={rowIndex}
              top={HEADER_HEIGHT + item.start}
              columns={columns}
              payloads={payloads}
              remote={remote}
              marks={marks}
              selectedCol={selection?.row === rowIndex ? selection.col : -1}
              editing={editing?.rowIndex === rowIndex ? editing : null}
              readOnly={readOnly}
              handlers={handlers}
            />
          );
        })}
      </div>

      {columns.filter((column) => column.type === 'select').map((column) => (
        <datalist key={column.key} id={`options-${column.key}`}>
          {column.options.map((option) => <option key={option} value={option} />)}
        </datalist>
      ))}
    </div>
  );
}
