import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-md rounded-md border border-slate-800 bg-slate-900 p-5">
          <h1 className="text-sm font-semibold text-slate-100">The workspace hit an unexpected error</h1>
          <p className="mt-2 font-mono text-xs text-rose-300">{this.state.error.message}</p>
          <p className="mt-3 text-xs text-slate-400">Queued offline edits are stored locally and will sync after you reload.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700">
            Reload workspace
          </button>
        </div>
      </div>
    );
  }
}
