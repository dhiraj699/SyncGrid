const STYLES = {
  ADMIN: 'bg-sky-400/10 text-sky-300 ring-sky-400/30',
  MANAGER: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  STAFF: 'bg-slate-400/10 text-slate-300 ring-slate-400/25',
};

export const RoleBadge = ({ role }) => (
  <span className={`rounded px-1.5 py-px font-mono text-[10.5px] font-medium ring-1 ring-inset ${STYLES[role] ?? STYLES.STAFF}`}>{role}</span>
);
