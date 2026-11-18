import { CircleAlert, Info, X } from 'lucide-react';
import { useEffect } from 'react';

const AUTO_DISMISS_MS = 6_000;

function Notice({ notice, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notice.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice.id, onDismiss]);

  const isError = notice.level === 'error';
  return (
    <div role="status" className={`flex w-80 items-start gap-2 rounded-md border bg-slate-900 p-3 shadow-lg shadow-black/40 ${isError ? 'border-rose-500/40' : 'border-slate-700'}`}>
      {isError ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-rose-400" /> : <Info size={14} className="mt-0.5 shrink-0 text-sky-400" />}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-slate-100">{notice.title}</p>
        {notice.detail && <p className="mt-0.5 text-[12px] text-slate-400">{notice.detail}</p>}
      </div>
      <button type="button" onClick={() => onDismiss(notice.id)} className="text-slate-500 hover:text-slate-200" aria-label="Dismiss"><X size={13} /></button>
    </div>
  );
}

export const Notices = ({ notices, onDismiss }) => (
  <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2 [&>*]:pointer-events-auto">
    {notices.map((notice) => <Notice key={notice.id} notice={notice} onDismiss={onDismiss} />)}
  </div>
);
