import { Wifi, WifiOff } from 'lucide-react';

const plural = (count, noun) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;

function ConnectionBadge({ connection, pending, revision, forcedOffline }) {
  if (connection === 'live' && pending === 0) {
    return <span className="flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live <span className="font-mono tabular-nums text-slate-500">· rev {revision.toLocaleString()}</span></span>;
  }
  if (connection === 'live') {
    return <span className="flex items-center gap-1.5 text-sky-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />Syncing {plural(pending, 'operation')}…</span>;
  }
  if (connection === 'connecting') {
    return <span className="flex items-center gap-1.5 text-sky-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />Connecting…</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {forcedOffline || !navigator.onLine ? 'Offline' : 'Reconnecting'} — {pending === 0 ? 'no pending operations' : `${plural(pending, 'operation')} queued locally`}
    </span>
  );
}

export function StatusBar({ connection, pending, revision, forcedOffline, onToggleOffline, rowCount, columnCount, replayLabel }) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-800 bg-slate-950 px-3 text-[11.5px]">
      <ConnectionBadge connection={connection} pending={pending} revision={revision} forcedOffline={forcedOffline} />
      {replayLabel && <span className="rounded bg-sky-400/10 px-1.5 py-px font-mono text-[10.5px] text-sky-300 ring-1 ring-inset ring-sky-400/30">{replayLabel}</span>}
      <span className="ml-auto font-mono tabular-nums text-slate-500">
        {rowCount.toLocaleString()} rows × {columnCount} cols · {(rowCount * columnCount).toLocaleString()} cells
      </span>
      <button
        type="button"
        onClick={onToggleOffline}
        className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-all ${
          forcedOffline
            ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/50 hover:bg-rose-500/30'
            : 'bg-slate-900 text-slate-300 ring-1 ring-slate-700/80 hover:bg-slate-800 hover:text-white'
        }`}
        title="Simulate network disconnection to demonstrate IndexedDB offline queueing and automatic reconciliation upon reconnect"
      >
        {forcedOffline ? (
          <>
            <WifiOff size={12} className="animate-pulse text-rose-400" />
            <span>Simulate Offline (Active)</span>
            {pending > 0 && (
              <span className="rounded bg-rose-500/40 px-1 py-px font-mono text-[9.5px] text-rose-200">
                {pending} queued
              </span>
            )}
          </>
        ) : (
          <>
            <Wifi size={12} className="text-emerald-400" />
            <span>Simulate Network Drop</span>
          </>
        )}
      </button>
    </footer>
  );
}
