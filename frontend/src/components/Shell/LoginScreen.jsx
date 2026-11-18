import { useState } from 'react';
import { Logo } from './Logo.jsx';
import { RoleBadge } from './RoleBadge.jsx';

const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || '';
const DEMO_ACCOUNTS = [
  { email: 'dhirajdk09062006@gmail.com', name: 'Dhiraj Kumar', role: 'ADMIN', blurb: 'Full access, audit, schema' },
  { email: 'd24950528@gmail.com', name: 'Suraj Kumar', role: 'MANAGER', blurb: 'Read and write, no schema changes' },
  { email: 'ansh.raj@syncgrid.dev', name: 'Ansh Raj', role: 'STAFF', blurb: 'Confidential columns masked' },
  { email: 'niraj.nayak@syncgrid.dev', name: 'Niraj Kumar Nayak', role: 'STAFF', blurb: 'Confidential columns masked' },
];

export function LoginScreen({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (nextEmail, nextPassword) => {
    setBusy(true);
    setError(null);
    try {
      await onSignIn(nextEmail, nextPassword);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={22} />
          <span className="text-[15px] font-semibold tracking-tight text-slate-100">SyncGrid</span>
          <span className="text-xs text-slate-500">Inventory workspace</span>
        </div>

        {/* 1-Click Persona Switcher */}
        <div className="mb-4 rounded-md border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">1-Click Persona Switcher</span>
            <span className="text-[10.5px] font-mono text-sky-400">Instant Demo Login</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('dhirajdk09062006@gmail.com', DEMO_PASSWORD)}
              className="flex flex-col items-center rounded border border-orange-500/30 bg-orange-500/10 px-2 py-2 text-center transition hover:border-orange-500/50 hover:bg-orange-500/20 disabled:opacity-50"
              title="Sign in as Dhiraj Kumar (Admin - Full Access & Schema)"
            >
              <span className="text-xs font-semibold text-orange-200">Dhiraj</span>
              <span className="font-mono text-[10px] text-orange-400">Admin</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('d24950528@gmail.com', DEMO_PASSWORD)}
              className="flex flex-col items-center rounded border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-center transition hover:border-amber-500/50 hover:bg-amber-500/20 disabled:opacity-50"
              title="Sign in as Suraj Kumar (Manager - Read/Write)"
            >
              <span className="text-xs font-semibold text-amber-200">Suraj</span>
              <span className="font-mono text-[10px] text-amber-400">Manager</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('ansh.raj@syncgrid.dev', DEMO_PASSWORD)}
              className="flex flex-col items-center rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-center transition hover:border-emerald-500/50 hover:bg-emerald-500/20 disabled:opacity-50"
              title="Sign in as Ansh Raj (Staff - Masked Confidential)"
            >
              <span className="text-xs font-semibold text-emerald-200">Ansh</span>
              <span className="font-mono text-[10px] text-emerald-400">Staff</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('niraj.nayak@syncgrid.dev', DEMO_PASSWORD)}
              className="flex flex-col items-center rounded border border-sky-500/30 bg-sky-500/10 px-2 py-2 text-center transition hover:border-sky-500/50 hover:bg-sky-500/20 disabled:opacity-50"
              title="Sign in as Niraj Kumar Nayak (Staff - Masked Confidential)"
            >
              <span className="text-xs font-semibold text-sky-200">Niraj</span>
              <span className="font-mono text-[10px] text-sky-400">Staff</span>
            </button>
          </div>
        </div>

        <form
          className="rounded-md border border-slate-800 bg-slate-900/60 p-4"
          onSubmit={(event) => { event.preventDefault(); void submit(email, password); }}
        >
          <label className="block text-xs font-medium text-slate-400" htmlFor="email">Work email</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <label className="mt-3 block text-xs font-medium text-slate-400" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500" />
          {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
          <button type="submit" disabled={busy} className="mt-4 w-full rounded bg-sky-500 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <section className="mt-5">
          <h2 className="mb-2 text-xs font-medium text-slate-400">
            Demo accounts {DEMO_PASSWORD ? <span className="font-mono text-slate-600">· password {DEMO_PASSWORD}</span> : null}
          </h2>
          <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button type="button" disabled={busy} onClick={() => void submit(account.email, DEMO_PASSWORD)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-900 disabled:opacity-50">
                  <span>
                    <span className="block text-[13px] text-slate-200">{account.name}</span>
                    <span className="block text-[11px] text-slate-500">{account.blurb}</span>
                  </span>
                  <RoleBadge role={account.role} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
