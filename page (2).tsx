'use client';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { REPORT_REASONS } from '@/lib/types';
import { time } from '@/lib/format';

interface ReportRow {
  id: string;
  reason: string;
  comment?: string;
  automated: boolean;
  severity: number;
  createdAt: string;
  conversationId?: string;
  reporter: { name: string };
  reportedUser: { id: string; name: string; blockedAt: string | null };
  message?: { body: string | null; moderationFlags: string[] };
}

interface Detail {
  report: ReportRow;
  context: Array<{ id: string; body: string | null; kind: string; createdAt: string; verdict: string; sender?: { id: string; name: string } | null; moderationFlags: string[] }>;
  history: Array<{ status: string; _count: number }>;
}

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;

export default function SupportPage() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'DISMISSED'>('OPEN');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => api<ReportRow[]>(`/support/reports?status=${status}`).then(setRows), [status]);
  useEffect(() => { load(); }, [load]);

  const openReport = async (id: string) => setSelected(await api<Detail>(`/support/reports/${id}`));

  const act = async (action: 'DISMISS' | 'WARN_USER' | 'HIDE_MESSAGE' | 'BLOCK_USER') => {
    if (!selected) return;
    if (action === 'BLOCK_USER' && !confirm(`Block ${selected.report.reportedUser.name}? Their conversations will be frozen.`)) return;
    await api(`/support/reports/${selected.report.id}/resolve`, { method: 'POST', json: { action, note: note || undefined } });
    setSelected(null);
    setNote('');
    load();
  };

  const join = async () => {
    if (selected?.report.conversationId) await api(`/support/conversations/${selected.report.conversationId}/join`, { method: 'POST' });
  };

  return (
    <div className="flex h-full">
      <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-black/5 bg-white scroll-thin">
        <div className="flex gap-1 p-3 text-xs">
          {(['OPEN', 'RESOLVED', 'DISMISSED'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={clsx('rounded-full px-3 py-1', status === s ? 'bg-ink-900 text-white' : 'bg-black/5')}>{s.toLowerCase()}</button>
          ))}
        </div>
        {rows.map((r) => (
          <button key={r.id} onClick={() => openReport(r.id)}
            className={clsx('block w-full border-b border-black/5 px-4 py-3 text-left hover:bg-black/[0.03]', selected?.report.id === r.id && 'bg-brand-50')}>
            <div className="flex items-center gap-2">
              <span className={clsx('h-2 w-2 rounded-full', r.severity >= 4 ? 'bg-red-500' : r.severity >= 2 ? 'bg-amber-500' : 'bg-ink-400')} />
              <span className="text-sm font-semibold">{reasonLabel(r.reason)}</span>
              {r.automated && <span className="rounded bg-ink-900 px-1.5 text-[10px] font-semibold text-white">AUTO</span>}
            </div>
            <div className="mt-0.5 text-xs text-ink-500">{r.reporter.name} → <b>{r.reportedUser.name}</b>{r.reportedUser.blockedAt && ' (blocked)'}</div>
            {r.message?.body && <div className="mt-1 truncate text-xs italic text-ink-400">“{r.message.body}”</div>}
          </button>
        ))}
        {rows.length === 0 && <p className="p-6 text-center text-sm text-ink-400">Queue is empty</p>}
      </aside>

      <section className="flex-1 overflow-y-auto p-6 scroll-thin">
        {!selected ? (
          <p className="text-center text-sm text-ink-400">Select a report</p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="font-semibold">{reasonLabel(selected.report.reason)}</h2>
              {selected.report.comment && <p className="mt-1 text-sm">{selected.report.comment}</p>}
              <p className="mt-2 text-xs text-ink-500">
                Previous reports against this user: {selected.history.map((h) => `${h.status.toLowerCase()} ${h._count}`).join(', ')}
              </p>
            </div>
            <div className="space-y-1.5 rounded-xl bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">Conversation context</h3>
              {selected.context.map((m) => (
                <div key={m.id} className={clsx('rounded-lg px-3 py-1.5 text-sm',
                  m.sender?.id === selected.report.reportedUser.id ? 'bg-red-50' : 'bg-black/[0.03]',
                  m.verdict === 'BLOCK' && 'ring-1 ring-red-300')}>
                  <span className="mr-2 text-xs font-semibold">{m.sender?.name ?? 'System'}</span>
                  <span className="mr-2 text-[11px] text-ink-400">{time(m.createdAt)}</span>
                  {m.body ?? `[${m.kind}]`}
                  {m.moderationFlags.length > 0 && <div className="mt-0.5 text-[11px] text-red-600">flags: {m.moderationFlags.join(', ')}</div>}
                </div>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note / reason" rows={2}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => act('DISMISS')} className="rounded-lg border border-black/10 px-3 py-2 text-sm">Dismiss</button>
              <button onClick={() => act('WARN_USER')} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white">Warn user</button>
              <button onClick={() => act('HIDE_MESSAGE')} className="rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-white">Hide message</button>
              <button onClick={() => act('BLOCK_USER')} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">Block user</button>
              <button onClick={join} className="ml-auto rounded-lg border border-brand-500 px-3 py-2 text-sm text-brand-600">Join conversation</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
