'use client';
import { useEffect, useRef, useState } from 'react';
import { useChat } from '@/store/chat';
import { useAuth } from '@/store/auth';
import type { ChatMessage } from '@/lib/types';
import { PropertyCard } from './PropertyCard';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { FilesPanel } from './FilesPanel';
import { MeetingDialog, OfferDialog, ReportDialog } from './Dialogs';

const EMPTY: ChatMessage[] = [];

export function ChatWindow({ conversationId }: { conversationId: string }) {
  const me = useAuth((s) => s.user);
  const open = useChat((s) => s.open);
  const close = useChat((s) => s.close);
  const markRead = useChat((s) => s.markRead);
  const retry = useChat((s) => s.retry);
  const conv = useChat((s) => s.conversations.find((c) => c.id === conversationId));
  const messages = useChat((s) => s.messages[conversationId] ?? EMPTY);
  const typing = useChat((s) => s.typing[conversationId]);
  const [reporting, setReporting] = useState<{ message?: ChatMessage } | null>(null);
  const [dialog, setDialog] = useState<'meeting' | 'offer' | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    open(conversationId);
    const onVisible = () => document.visibilityState === 'visible' && markRead(conversationId);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      close();
    };
  }, [conversationId, open, close, markRead]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!conv || !me) return <div className="flex flex-1 items-center justify-center text-sm text-ink-400">Loading…</div>;

  const closed = conv.status !== 'OPEN';

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-2.5">
          <div>
            <div className="text-sm font-semibold">{conv.counterpart?.name}</div>
            <div className="text-xs text-ink-400">
              {typing ? <span className="text-brand-600">typing…</span> : conv.myRole === 'BUYER' ? 'Owner' : 'Interested in your listing'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFilesOpen((v) => !v)} className="rounded-lg px-2.5 py-1.5 text-xs text-ink-700 hover:bg-black/5">📎 Files</button>
            <button onClick={() => setReporting({})} className="rounded-lg px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50">Report user</button>
          </div>
        </header>

        <PropertyCard
          listing={conv.listing}
          myRole={conv.myRole}
          onRequestShowing={() => setDialog('meeting')}
          onSendOffer={() => setDialog('offer')}
        />

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4 scroll-thin">
          <div className="mx-auto max-w-md rounded-xl bg-white/70 px-3 py-2 text-center text-[11px] text-ink-500">
            🔒 Keep payments and documents inside this chat — that's what lets Support protect you.
          </div>
          {messages.map((m) => (
            <MessageBubble key={m.clientId ?? m.id} m={m}
              onReport={(msg) => setReporting({ message: msg })}
              onRetry={() => m.clientId && retry(conversationId, m.clientId)} />
          ))}
          <div ref={bottom} />
        </div>

        <Composer conversationId={conversationId} myRole={conv.myRole} disabled={closed} />
      </section>

      {filesOpen && <FilesPanel conversationId={conversationId} onClose={() => setFilesOpen(false)} />}
      {reporting && (
        <ReportDialog conversationId={conversationId} message={reporting.message} userId={conv.counterpart?.id} onClose={() => setReporting(null)} />
      )}
      {dialog === 'meeting' && <MeetingDialog conversationId={conversationId} onClose={() => setDialog(null)} />}
      {dialog === 'offer' && <OfferDialog conversationId={conversationId} listing={conv.listing} onClose={() => setDialog(null)} />}
    </div>
  );
}
