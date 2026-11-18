export function Logo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="2" stroke="#475569" strokeWidth="1.5" />
      <path d="M2.5 9h19M2.5 15h19M9 2.5v19M15 2.5v19" stroke="#334155" strokeWidth="1" />
      <rect x="9" y="9" width="6" height="6" fill="#38bdf8" />
    </svg>
  );
}
