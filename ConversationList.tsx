'use client';
import Link from 'next/link';
import { useState } from 'react';
import clsx from 'clsx';
import { money, relative } from '@/lib/format';
import { useChat } from '@/store/chat';
import { MessageStatus } from './MessageStatus';

type Filter = 'all' | 'buying' | 'selling' | 'awaiting';

export function ConversationList({ activeId }: { activeId?: string }) {
  const conversations = useChat((s) => s.conversations);
  const typing = useChat((s) => s.typing);
  const [filter, setFilter] = useState<Filter>('all');

  const list = conversations.filter((c) =>
    filter === 'all' ? true
    : filter === 'buying' ? c.myRole === 'BUYER'
    : filter === 'selling' ? c.myRole === 'SELLER'
    : c.awaitingReplyFrom === c.myRole);
  const awaiting = conversations.filter((c) => c.awaitingReplyFrom === c.myRole).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-3 py-3 text-xs">
        {([['all', 'All'], ['buying', 'Buying / renting'], ['selling', 'My listings'], ['awaiting', `Needs reply${awaiting ? ` · ${awaiting}` : ''}`]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={clsx('rounded-full px-2.5 py-1', filter === v ? 'bg-ink-900 text-white' : 'bg-black/5 text-ink-700 hover:bg-black/10')}>
            {l}
          </button>
        ))}
      </div>
      <ul className="flex-1 overflow-y-auto scroll-thin">
        {list.map((c) => {
          const waitingOnMe = c.awaitingReplyFrom === c.myRole && c.awaitingSince;
          return (
            <li key={c.id}>
              <Link href={`/inbox/${c.id}`}
                className={clsx('flex gap-3 border-b border-black/5 px-3 py-3 hover:bg-black/[0.03]', activeId === c.id && 'bg-brand-50')}>
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-brand-100">
                  {c.listing.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.listing.photos[0]} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className={clsx('absolute bottom-0 left-0 right-0 text-center text-[9px] font-bold uppercase text-white',
                    c.myRole === 'SELLER' ? 'bg-ink-900/70' : 'bg-brand-600/80')}>
                    {c.myRole === 'SELLER' ? 'Owner' : c.listing.type === 'RENT' ? 'Rent' : 'Buy'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.counterpart?.name ?? '—'}</span>
                    {c.lastMessage && <span className="shrink-0 text-[11px] text-ink-400">{relative(c.lastMessage.createdAt)}</span>}
                  </div>
                  <div className="truncate text-xs text-ink-500">{c.listing.title} · {money(c.listing.price, c.listing.currency, c.listing.rentPeriod)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {c.lastMessage?.mine && c.lastMessage.status && <MessageStatus status={c.lastMessage.status} />}
                    <span className={clsx('min-w-0 flex-1 truncate text-xs', c.unread ? 'font-semibold text-ink-900' : 'text-ink-500')}>
                      {typing[c.id] ? <em className="text-brand-600">typing…</em> : preview(c.lastMessage)}
                    </span>
                    {c.unread > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{c.unread}</span>}
                  </div>
                  {waitingOnMe && (
                    <div className="mt-1 text-[11px] font-medium text-amber-700">⏱ Waiting for your reply · {relative(c.awaitingSince!)}</div>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
        {list.length === 0 && <li className="p-6 text-center text-sm text-ink-400">No conversations</li>}
      </ul>
    </div>
  );
}

function preview(m?: { kind: string; body: string | null; attachments: unknown[] }) {
  if (!m) return 'No messages yet';
  if (m.kind === 'MEETING_REQUEST') return '📅 Viewing request';
  if (m.kind === 'OFFER') return '📝 Terms sent';
  if (m.body) return m.body;
  if (m.attachments.length) return `📎 ${m.attachments.length} file(s)`;
  return '';
}
