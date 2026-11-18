import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GitCompareArrows, History, Radio } from 'lucide-react';
import { useMemo } from 'react';
import { SYSTEM_AUTHOR_ID } from '../../config.js';
import { coordinateOf, parseCellId } from '../../domain/cellId.js';
import { formatCellValue } from '../../domain/format.js';
import { summarizeDiff } from '../../domain/replay.js';

const BUCKETS = 72;
const MAX_DIFF_ROWS = 120;
const KIND_STYLES = {
  added: 'text-emerald-300',
  modified: 'text-sky-300',
  cleared: 'text-rose-300',
  reverted: 'text-slate-500',
};

const timeLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function ActivityStrip({ events }) {
  const bars = useMemo(() => {
    if (events.length === 0) return [];
    const first = events[0].timestamp;
    const span = Math.max(1, events.at(-1).timestamp - first);
    const counts = new Array(BUCKETS).fill(0);
    for (const event of events) counts[Math.min(BUCKETS - 1, Math.floor(((event.timestamp - first) / span) * BUCKETS))] += 1;
    const peak = Math.max(...counts);
    return counts.map((count) => count / peak);
  }, [events]);

  return (
    <svg className="h-6 w-full" viewBox={`0 0 ${BUCKETS} 10`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((height, index) => (
        <rect key={index} x={index + 0.15} width="0.7" y={10 - height * 10} height={Math.max(height * 10, height > 0 ? 0.6 : 0)} fill="#475569" />
      ))}
    </svg>
  );
}

function formatValue(column, value, isMasked) {
  if (isMasked) return '••••';
  return value === null ? '∅' : formatCellValue(column, value);
}

export function HistoryDrawer({ replay, open, onToggle, canAudit, users, columns, diffFrom, onDiffFromChange, onJump }) {
  const { position, eventCount, events, baselineSeq, status } = replay;
  const authorOf = (authorId) => users[authorId] ?? { name: authorId === SYSTEM_AUTHOR_ID ? 'System seed' : authorId, color: '#64748b', initials: '··' };
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const diffActive = diffFrom !== null;

  const diffRows = useMemo(() => {
    if (!diffActive || status !== 'ready') return [];
    return summarizeDiff(events, diffFrom, position).sort((left, right) => right.lastTimestamp - left.lastTimestamp);
  }, [diffActive, diffFrom, position, status, events, eventCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentEvent = position > 0 ? events[position - 1] : null;
  const currentColumn = currentEvent ? columnByKey.get(parseCellId(currentEvent.cellId).columnKey) : null;

  return (
    <section className="shrink-0 border-t border-slate-800 bg-slate-950" aria-label="Time travel">
      <button type="button" disabled={!canAudit} onClick={onToggle}
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12px] text-slate-300 hover:bg-slate-900 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent">
        <History size={13} />
        <span className="font-medium">History</span>
        <span className="text-slate-500">{canAudit ? 'Replay and audit every cell mutation' : 'Requires the ADMIN role'}</span>
        {canAudit && <span className="ml-auto text-slate-500">{open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</span>}
      </button>

      {open && canAudit && (
        <div className="border-t border-slate-800 px-3 py-2.5">
          {status === 'loading' && <p className="py-6 text-center text-xs text-slate-500">Loading event log…</p>}
          {status === 'error' && <p className="py-6 text-center text-xs text-rose-300">{replay.error}</p>}
          {status === 'ready' && eventCount === 0 && <p className="py-6 text-center text-xs text-slate-500">No edits yet. Change a cell and it will appear on this timeline.</p>}

          {status === 'ready' && eventCount > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => replay.seek(position - 1)} disabled={position === 0} className="rounded border border-slate-800 p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30" aria-label="Step back"><ChevronLeft size={13} /></button>
                <button type="button" onClick={() => replay.seek(position + 1)} disabled={position === eventCount} className="rounded border border-slate-800 p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30" aria-label="Step forward"><ChevronRight size={13} /></button>
                <span className="font-mono text-[11.5px] tabular-nums text-slate-300">
                  event {position.toLocaleString()} / {eventCount.toLocaleString()}
                  <span className="text-slate-600"> · seq {(baselineSeq + position).toLocaleString()}</span>
                </span>
                {currentEvent ? (
                  <span className="min-w-0 truncate text-[12px] text-slate-400">
                    <span className="font-mono text-sky-300">{coordinateOf(currentEvent.cellId, columns)}</span>{' '}
                    {formatValue(currentColumn, currentEvent.previousValue, currentEvent.isMasked)} → <span className="text-slate-200">{formatValue(currentColumn, currentEvent.value, currentEvent.isMasked)}</span>{' '}
                    by <span style={{ color: authorOf(currentEvent.authorId).color }}>{authorOf(currentEvent.authorId).name}</span> at {timeLabel(currentEvent.timestamp)}
                  </span>
                ) : <span className="text-[12px] text-slate-500">Baseline — the sheet before any user edits</span>}

                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => onDiffFromChange(diffActive ? null : 0)}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11.5px] ${diffActive ? 'border-sky-500/50 bg-sky-400/10 text-sky-300' : 'border-slate-800 text-slate-300 hover:bg-slate-800'}`}>
                    <GitCompareArrows size={12} />Audit diff
                  </button>
                  <button type="button" onClick={() => replay.seek(eventCount)} disabled={!replay.isReplaying}
                    className="flex items-center gap-1.5 rounded border border-slate-800 px-2 py-1 text-[11.5px] text-slate-300 hover:bg-slate-800 disabled:opacity-30">
                    <Radio size={12} />Return to live
                  </button>
                </div>
              </div>

              <div className="mt-1.5">
                <ActivityStrip events={events} />
                <input type="range" className="scrubber w-full" min={0} max={eventCount} step={1} value={position}
                  onChange={(event) => replay.seek(Number(event.target.value))} aria-label="Replay position" />
                {diffActive && (
                  <div className="mt-2 flex items-center gap-2 text-[11.5px] text-slate-400">
                    <span className="w-24 shrink-0">Compare from</span>
                    <input type="range" className="scrubber w-full" min={0} max={eventCount} step={1} value={diffFrom}
                      onChange={(event) => onDiffFromChange(Number(event.target.value))} aria-label="Diff start position" />
                    <span className="w-28 shrink-0 text-right font-mono tabular-nums text-slate-300">event {diffFrom}</span>
                  </div>
                )}
              </div>

              {diffActive && (
                <div className="mt-2 max-h-40 overflow-auto rounded border border-slate-800">
                  <table className="w-full text-left text-[12px]">
                    <thead className="sticky top-0 bg-slate-900 text-slate-500">
                      <tr>
                        <th className="px-2 py-1 font-medium">Cell</th>
                        <th className="px-2 py-1 font-medium">Column</th>
                        <th className="px-2 py-1 font-medium">Change</th>
                        <th className="px-2 py-1 font-medium">Edited by</th>
                        <th className="px-2 py-1 text-right font-medium">Edits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows.slice(0, MAX_DIFF_ROWS).map((row) => {
                        const column = columnByKey.get(parseCellId(row.cellId).columnKey);
                        return (
                          <tr key={row.cellId} onClick={() => onJump(row.cellId)} className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-900">
                            <td className="px-2 py-1 font-mono tabular-nums text-sky-300">{coordinateOf(row.cellId, columns)}</td>
                            <td className="px-2 py-1 text-slate-400">{column?.label}</td>
                            <td className={`px-2 py-1 tabular-nums ${KIND_STYLES[row.kind]}`}>{formatValue(column, row.before, row.isMasked)} → {formatValue(column, row.after, row.isMasked)}</td>
                            <td className="px-2 py-1">{row.authors.map((authorId) => <span key={authorId} className="mr-2" style={{ color: authorOf(authorId).color }}>{authorOf(authorId).name}</span>)}</td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-400">{row.edits}</td>
                          </tr>
                        );
                      })}
                      {diffRows.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">No differences in this range.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              {diffActive && diffRows.length > MAX_DIFF_ROWS && <p className="mt-1 text-[11px] text-slate-500">Showing the latest {MAX_DIFF_ROWS} of {diffRows.length.toLocaleString()} changed cells.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
