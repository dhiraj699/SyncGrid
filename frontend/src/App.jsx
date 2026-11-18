import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataGrid } from './components/Grid/DataGrid.jsx';
import { HistoryDrawer } from './components/History/HistoryDrawer.jsx';
import { ErrorBoundary } from './components/Shell/ErrorBoundary.jsx';
import { FormulaBar } from './components/Shell/FormulaBar.jsx';
import { LoginScreen } from './components/Shell/LoginScreen.jsx';
import { Notices } from './components/Shell/Notices.jsx';
import { StatusBar } from './components/Shell/StatusBar.jsx';
import { TopBar } from './components/Shell/TopBar.jsx';
import { SHEET_ID } from './config.js';
import { formatCellId, toCoordinate } from './domain/cellId.js';
import { useAuth } from './hooks/useAuth.js';
import { useReplay } from './hooks/useReplay.js';
import { useSheetSync } from './hooks/useSheetSync.js';
import { api } from './services/apiClient.js';
import { pendingCount } from './state/sheetReducer.js';

const NEUTRAL_AUTHOR_COLOR = '#64748b';

function Workspace({ session, onSignOut }) {
  const { user, token } = session;
  const sync = useSheetSync({ sheetId: SHEET_ID, token, user });
  const { state } = sync;

  const [selection, setSelection] = useState({ row: 0, col: 0 });
  const [directory, setDirectory] = useState({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffFrom, setDiffFrom] = useState(null);

  const canAudit = user.role === 'ADMIN';
  const replay = useReplay({ sheetId: SHEET_ID, active: historyOpen && canAudit, liveRevision: state.revision });
  const replaying = replay.isReplaying;

  useEffect(() => {
    api.getDirectory().then(({ users }) => setDirectory(Object.fromEntries(users.map((entry) => [entry.id, entry])))).catch(() => {});
  }, []);

  const columns = state.sheet?.columns ?? [];
  const rowCount = state.sheet?.rowCount ?? 0;

  const peers = useMemo(() => {
    const byUser = new Map([[user.id, { userId: user.id, name: user.name, initials: user.initials, color: user.color }]]);
    for (const entry of Object.values(state.presence)) if (!byUser.has(entry.userId)) byUser.set(entry.userId, entry);
    return [...byUser.values()];
  }, [state.presence, user]);

  const presenceByCell = useMemo(() => {
    const grouped = new Map();
    for (const entry of Object.values(state.presence)) {
      if (!entry.cellId) continue;
      grouped.set(entry.cellId, [...(grouped.get(entry.cellId) ?? []), entry]);
    }
    return grouped;
  }, [state.presence]);

  const colorOf = useCallback((authorId) => directory[authorId]?.color ?? NEUTRAL_AUTHOR_COLOR, [directory]);

  const decorations = useMemo(() => {
    if (!historyOpen || replay.status !== 'ready') return undefined;
    const marks = new Map();
    if (diffFrom !== null) {
      const lower = Math.min(diffFrom, replay.position);
      const upper = Math.max(diffFrom, replay.position);
      for (let index = lower; index < upper; index += 1) {
        const event = replay.events[index];
        marks.set(event.cellId, { color: colorOf(event.authorId) });
      }
    } else if (replaying && replay.position > 0) {
      const event = replay.events[replay.position - 1];
      marks.set(event.cellId, { color: colorOf(event.authorId) });
    }
    return marks;
  }, [historyOpen, replay.status, replay.position, replay.events, replay.version, diffFrom, replaying, colorOf]);

  const selectedColumn = columns[selection.col];
  const selectedCellId = selectedColumn ? formatCellId(selection.row, selectedColumn.key) : null;
  const visibleCells = replaying ? replay.cells : state.cells;
  const selectedPayload = selectedCellId ? (replaying ? undefined : state.overlay[selectedCellId]) ?? visibleCells[selectedCellId] : undefined;

  const handleSelect = useCallback((next) => {
    setSelection(next);
    const column = state.sheet?.columns[next.col];
    if (column) sync.announceSelection(formatCellId(next.row, column.key));
  }, [state.sheet, sync.announceSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToCell = useCallback((cellId) => {
    const [row, columnKey] = [Number(cellId.slice(0, cellId.indexOf(':'))), cellId.slice(cellId.indexOf(':') + 1)];
    const col = columns.findIndex((column) => column.key === columnKey);
    if (col >= 0) handleSelect({ row, col });
  }, [columns, handleSelect]);

  const toggleHistory = () => {
    if (historyOpen) {
      if (replay.status === 'ready') replay.seek(replay.eventCount);
      setDiffFrom(null);
    }
    setHistoryOpen((open) => !open);
  };

  const toggleConfidential = useCallback(async (column) => {
    try {
      await api.patchColumn(SHEET_ID, column.key, { confidential: !column.confidential });
    } catch (error) {
      sync.notify('error', 'Schema change failed', error.message);
    }
  }, [sync.notify]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.phase === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-sm text-slate-300">
        <p>Could not load the sheet: <span className="font-mono text-rose-300">{state.error}</span></p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void sync.refresh().catch(() => {})} className="rounded border border-slate-700 px-3 py-1.5 hover:bg-slate-800">Retry</button>
          <button type="button" onClick={onSignOut} className="rounded border border-slate-700 px-3 py-1.5 hover:bg-slate-800">Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950">
      <TopBar sheetName={state.sheet?.name} revision={state.revision} user={user} peers={peers} onSignOut={onSignOut} onExportCsv={() => api.exportCsv(SHEET_ID).catch((err) => sync.notify('error', 'Export failed', err.message))} />
      <FormulaBar
        coordinate={toCoordinate(selection.row, selection.col)}
        column={selectedColumn}
        payload={selectedPayload}
        readOnly={replaying}
        canUndo={state.history.undo.length > 0}
        canRedo={state.history.redo.length > 0}
        onUndo={sync.undo}
        onRedo={sync.redo}
      />

      <main className="relative min-h-0 flex-1">
        {state.phase === 'loading' ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">Loading sheet…</div>
        ) : (
          <DataGrid
            columns={columns}
            rowCount={rowCount}
            cells={visibleCells}
            overlay={replaying ? undefined : state.overlay}
            readOnly={replaying}
            selection={selection}
            onSelectionChange={handleSelect}
            presenceByCell={presenceByCell}
            decorations={decorations}
            onCommit={sync.commitCell}
            onUndo={sync.undo}
            onRedo={sync.redo}
            canEditSchema={canAudit && !replaying}
            onToggleConfidential={toggleConfidential}
          />
        )}
        {replaying && (
          <div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
            <span className="rounded border border-sky-500/40 bg-slate-900/95 px-2.5 py-1 text-[11.5px] text-sky-200 shadow-lg">
              Replaying history — read-only. Live edits continue in the background.
            </span>
          </div>
        )}
      </main>

      <HistoryDrawer
        replay={replay}
        open={historyOpen}
        onToggle={toggleHistory}
        canAudit={canAudit}
        users={directory}
        columns={columns}
        diffFrom={diffFrom}
        onDiffFromChange={setDiffFrom}
        onJump={jumpToCell}
      />
      <StatusBar
        connection={sync.connection}
        pending={pendingCount(state)}
        revision={state.revision}
        forcedOffline={sync.forcedOffline}
        onToggleOffline={sync.toggleOffline}
        rowCount={rowCount}
        columnCount={columns.length}
        replayLabel={replaying ? `replay @ seq ${(replay.baselineSeq + replay.position).toLocaleString()}` : null}
      />
      <Notices notices={state.notices} onDismiss={sync.dismissNotice} />
    </div>
  );
}

export default function App() {
  const { session, signIn, signOut } = useAuth();
  return (
    <ErrorBoundary>
      {session ? <Workspace key={session.user.id} session={session} onSignOut={signOut} /> : <LoginScreen onSignIn={signIn} />}
    </ErrorBoundary>
  );
}
