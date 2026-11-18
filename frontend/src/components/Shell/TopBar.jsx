import { Download, LogOut } from 'lucide-react';
import { Logo } from './Logo.jsx';
import { RoleBadge } from './RoleBadge.jsx';

export function TopBar({ sheetName, revision, user, peers, onSignOut, onExportCsv }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[13px] font-semibold tracking-tight text-slate-100">SyncGrid</span>
      </div>
      <span className="h-4 w-px bg-slate-800" />
      <span className="truncate text-[13px] text-slate-300">{sheetName ?? 'Loading sheet…'}</span>
      <span className="rounded bg-slate-900 px-1.5 py-px font-mono text-[10.5px] tabular-nums text-slate-400 ring-1 ring-inset ring-slate-800" title="Latest event sequence applied">
        rev {revision.toLocaleString()}
      </span>

      <div className="ml-auto flex items-center gap-3">
        {onExportCsv && (
          <button
            type="button"
            onClick={onExportCsv}
            title="Export CSV (role-safe: confidential columns masked for Staff)"
            className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/90 px-2 py-1 text-[11.5px] font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <Download size={13} className="text-sky-400" />
            <span>Export CSV</span>
          </button>
        )}
        <div className="flex -space-x-1.5" aria-label={`${peers.length} collaborators online`}>
          {peers.map((peer) => (
            <span key={peer.userId} title={peer.name}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-slate-950 text-[10px] font-semibold text-slate-950"
              style={{ backgroundColor: peer.color }}>
              {peer.initials}
            </span>
          ))}
        </div>
        <span className="h-4 w-px bg-slate-800" />
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-300">{user.name}</span>
          <RoleBadge role={user.role} />
        </div>
        <button type="button" onClick={onSignOut} title="Sign out" className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200">
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
