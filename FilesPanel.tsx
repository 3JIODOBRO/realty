'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { bytes } from '@/lib/format';
import type { Attachment } from '@/lib/types';

const SIZE_BUCKETS = [
  { label: 'Any size', min: undefined, max: undefined },
  { label: '< 1 MB', min: undefined, max: 1024 * 1024 },
  { label: '1–10 MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
  { label: '> 10 MB', min: 10 * 1024 * 1024, max: undefined },
];
const TYPES = ['', 'pdf', 'docx', 'xlsx', 'jpg', 'png'];

/** Side panel: every photo and document shared in this deal, filterable by name, size and type */
export function FilesPanel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [kind, setKind] = useState<'' | 'PHOTO' | 'DOCUMENT'>('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [size, setSize] = useState(0);
  const [sort, setSort] = useState<'date' | 'size' | 'name'>('date');
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    if (q) p.set('q', q);
    if (type) p.set('type', type);
    const b = SIZE_BUCKETS[size];
    if (b.min) p.set('minSize', String(b.min));
    if (b.max) p.set('maxSize', String(b.max));
    p.set('sort', sort);
    setLoading(true);
    const t = setTimeout(() => {
      api<{ items: Attachment[] }>(`/conversations/${conversationId}/attachments?${p}`)
        .then((r) => setItems(r.items))
        .finally(() => setLoading(false));
    }, 250); // debounce typing
    return () => clearTimeout(t);
  }, [conversationId, kind, q, type, size, sort]);

  const open = async (a: Attachment) => {
    const { url } = await api<{ url: string }>(`/attachments/${a.id}/url`);
    window.open(url, '_blank', 'noopener');
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-black/5 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold">Files in this deal</h3>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-900">✕</button>
      </div>
      <div className="space-y-2 px-4 pb-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/5 p-1 text-xs">
          {([['', 'All'], ['PHOTO', 'Photos'], ['DOCUMENT', 'Docs']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setKind(v)} className={clsx('rounded-md py-1', kind === v ? 'bg-white shadow' : 'text-ink-500')}>{l}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by file name" className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-sm" />
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-black/10 px-1.5 py-1">
            {TYPES.map((t) => <option key={t} value={t}>{t ? t.toUpperCase() : 'Any type'}</option>)}
          </select>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded-lg border border-black/10 px-1.5 py-1">
            {SIZE_BUCKETS.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-lg border border-black/10 px-1.5 py-1">
            <option value="date">Newest</option><option value="size">Largest</option><option value="name">Name A–Z</option>
          </select>
        </div>
      </div>
      <ul className={clsx('flex-1 space-y-1 overflow-y-auto px-2 pb-3 scroll-thin', loading && 'opacity-60')}>
        {items.length === 0 && !loading && <li className="px-2 py-6 text-center text-xs text-ink-400">No files match these filters</li>}
        {items.map((a) => (
          <li key={a.id}>
            <button onClick={() => open(a)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-black/5">
              <span className={clsx('flex h-8 w-8 items-center justify-center rounded text-[10px] font-bold uppercase text-white',
                a.kind === 'PHOTO' ? 'bg-brand-500' : 'bg-red-500')}>
                {a.fileName.split('.').pop()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{a.fileName}</span>
                <span className="text-[11px] text-ink-400">{bytes(a.sizeBytes)} · {a.createdAt && new Date(a.createdAt).toLocaleDateString()}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
