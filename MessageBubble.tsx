'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { api } from '@/lib/api';
import { bytes, money, slot, time } from '@/lib/format';
import type { Attachment, ChatMessage, MeetingPayload, OfferPayload } from '@/lib/types';
import { MessageStatus } from './MessageStatus';

const MEETING_LABEL = { SHOWING: 'Viewing request', MEETING: 'Meeting request', RESERVATION: 'Reservation request' } as const;

async function openAttachment(a: Attachment) {
  const { url } = await api<{ url: string }>(`/attachments/${a.id}/url`);
  window.open(url, '_blank', 'noopener');
}

export function MessageBubble({ m, onReport, onRetry }: { m: ChatMessage; onReport: (m: ChatMessage) => void; onRetry: () => void }) {
  if (m.kind === 'SYSTEM') return <SystemMessage m={m} />;

  if (m.hidden) {
    return (
      <div className={clsx('flex', m.mine ? 'justify-end' : 'justify-start')}>
        <div className="rounded-xl border border-dashed border-black/10 px-3 py-2 text-xs italic text-ink-400">
          Message removed by moderation{m.safetyTip ? ` — ${m.safetyTip}` : ''}
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('group flex flex-col', m.mine ? 'items-end' : 'items-start')}>
      {!m.mine && m.verdict === 'WARN' && m.safetyTip && (
        <div role="alert" className="mb-1 max-w-[75%] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong className="font-semibold">Safety tip: </strong>{m.safetyTip}
        </div>
      )}
      <div className="flex max-w-[75%] items-end gap-1.5">
        {!m.mine && (
          <button onClick={() => onReport(m)} title="Report message"
            className="order-last mb-1 hidden rounded p-1 text-ink-400 hover:bg-black/5 hover:text-red-600 group-hover:block">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="M3 14V2.5h8l-1.5 3 1.5 3H3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
        )}
        <div className={clsx(
          'rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          m.mine ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-white text-ink-900',
          m.status === 'blocked' && 'bg-red-50 text-red-900 ring-1 ring-red-200',
        )}>
          {m.kind === 'MEETING_REQUEST' && <MeetingCard m={m} />}
          {m.kind === 'OFFER' && <OfferCard m={m} />}
          {m.attachments.length > 0 && <Attachments items={m.attachments} mine={m.mine} />}
          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
          <div className={clsx('mt-1 flex items-center justify-end gap-1 text-[11px]', m.mine ? 'text-white/70' : 'text-ink-400')}>
            {time(m.createdAt)}
            {m.mine && m.status && (
              <span className={clsx('rounded px-0.5', m.mine && m.status !== 'read' && 'bg-white/90', m.status === 'read' && 'bg-white')}>
                <MessageStatus status={m.status} onRetry={onRetry} />
              </span>
            )}
          </div>
        </div>
      </div>
      {m.status === 'blocked' && (
        <p className="mt-1 max-w-[75%] text-right text-xs text-red-600">{m.notice ?? 'Not delivered: blocked by safety rules.'}</p>
      )}
    </div>
  );
}

function Attachments({ items, mine }: { items: Attachment[]; mine: boolean }) {
  const photos = items.filter((a) => a.kind === 'PHOTO');
  const docs = items.filter((a) => a.kind === 'DOCUMENT');
  return (
    <div className="mb-1.5 space-y-1.5">
      {photos.length > 0 && (
        <div className={clsx('grid gap-1', photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {photos.map((p) => (
            <button key={p.id} onClick={() => openAttachment(p)}
              className="flex aspect-[4/3] w-40 items-center justify-center rounded-lg bg-black/10 text-xs">
              📷 {p.fileName}
            </button>
          ))}
        </div>
      )}
      {docs.map((d) => (
        <button key={d.id} onClick={() => openAttachment(d)}
          className={clsx('flex w-60 items-center gap-2 rounded-lg px-2 py-1.5 text-left', mine ? 'bg-white/15' : 'bg-black/5')}>
          <span className="rounded bg-red-500 px-1 text-[10px] font-bold uppercase text-white">{d.fileName.split('.').pop()}</span>
          <span className="min-w-0 flex-1 truncate text-xs">{d.fileName}</span>
          <span className="text-[11px] opacity-70">{bytes(d.sizeBytes)}</span>
        </button>
      ))}
    </div>
  );
}

function MeetingCard({ m }: { m: ChatMessage }) {
  const p = m.payload as MeetingPayload;
  const respond = (action: 'ACCEPT' | 'DECLINE', s?: string) =>
    api(`/messages/${m.id}/respond`, { method: 'POST', json: { action, slot: s } });
  return (
    <div className="mb-1 min-w-56">
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">📅 {MEETING_LABEL[p.type]}</div>
      <ul className="mt-1.5 space-y-1">
        {p.slots.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2">
            <span className={clsx(p.chosenSlot === s && 'font-semibold underline')}>{slot(s)}</span>
            {!m.mine && p.status === 'PENDING' && (
              <button onClick={() => respond('ACCEPT', s)} className="rounded bg-brand-500 px-2 py-0.5 text-xs text-white">Confirm</button>
            )}
          </li>
        ))}
      </ul>
      {p.note && <p className="mt-1 text-xs opacity-80">{p.note}</p>}
      <StatusLine status={p.status} />
      {!m.mine && p.status === 'PENDING' && (
        <button onClick={() => respond('DECLINE')} className="mt-1 text-xs underline opacity-70">None of these work</button>
      )}
    </div>
  );
}

function OfferCard({ m }: { m: ChatMessage }) {
  const p = m.payload as OfferPayload;
  const respond = (action: 'ACCEPT' | 'DECLINE') => api(`/messages/${m.id}/respond`, { method: 'POST', json: { action } });
  return (
    <div className="mb-1 min-w-60">
      <div className="text-xs font-semibold uppercase tracking-wide opacity-80">📝 Terms</div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <dt className="opacity-70">Price</dt><dd className="font-semibold">{money(p.price, p.currency)}</dd>
        {p.deposit != null && (<><dt className="opacity-70">Deposit</dt><dd>{money(p.deposit, p.currency)}</dd></>)}
        {p.termMonths && (<><dt className="opacity-70">Term</dt><dd>{p.termMonths} months</dd></>)}
        {p.moveInDate && (<><dt className="opacity-70">Move-in</dt><dd>{new Date(p.moveInDate).toLocaleDateString()}</dd></>)}
      </dl>
      {p.conditions && <p className="mt-1 text-xs opacity-80">{p.conditions}</p>}
      <StatusLine status={p.status} />
      {!m.mine && p.status === 'PENDING' && (
        <div className="mt-2 flex gap-2">
          <button onClick={() => respond('ACCEPT')} className="rounded bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white">Accept</button>
          <button onClick={() => respond('DECLINE')} className="rounded border border-black/10 px-2.5 py-1 text-xs">Decline</button>
        </div>
      )}
      {!m.mine && p.status === 'ACCEPTED' && p.deposit && (
        <Link href={`/checkout/${m.id}`} className="mt-2 inline-block rounded bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white">
          Pay secure deposit
        </Link>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: string }) {
  const map: Record<string, string> = { PENDING: 'Waiting for answer', ACCEPTED: '✓ Accepted', DECLINED: '✕ Declined', COUNTERED: '↺ Counter-proposal' };
  return <div className="mt-1 text-[11px] font-medium opacity-80">{map[status]}</div>;
}

function SystemMessage({ m }: { m: ChatMessage }) {
  const p = (m.payload ?? {}) as { event?: string; similar?: Array<{ id: string; title: string; price: string; address: string }> };
  return (
    <div className="mx-auto my-1 max-w-md rounded-xl bg-brand-50 px-3 py-2 text-center text-xs text-brand-700">
      <span className="mr-1">🛡️</span>{m.body ?? systemText(p.event)}
      {p.similar && p.similar.length > 0 && (
        <div className="mt-2 space-y-1 text-left">
          {p.similar.map((s) => (
            <Link key={s.id} href={`/listings/${s.id}`} className="block rounded-lg bg-white px-2 py-1.5 hover:shadow">
              <div className="truncate font-semibold text-ink-900">{s.title}</div>
              <div className="truncate text-ink-500">{s.address} · {Number(s.price).toLocaleString()}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function systemText(event?: string) {
  switch (event) {
    case 'meeting_accepted': return 'Viewing confirmed. We will remind both of you 2 hours before.';
    case 'meeting_declined': return 'The owner could not make these times. Suggest new slots.';
    case 'offer_accepted': return 'Terms accepted. Pay the deposit only through the secure checkout.';
    case 'offer_declined': return 'Terms declined.';
    default: return 'Update';
  }
}
