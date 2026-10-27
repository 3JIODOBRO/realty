'use client';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { REPORT_REASONS, type ChatMessage, type ListingCard, type ReportReason } from '@/lib/types';
import { useChat } from '@/store/chat';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Report a message (or the user, when message is omitted) with a selectable reason */
export function ReportDialog({ message, userId, conversationId, onClose }: {
  message?: ChatMessage; userId?: string; conversationId: string; onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('FRAUD');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | string>('idle');

  const submit = async () => {
    setState('sending');
    try {
      await api('/reports', {
        method: 'POST',
        json: { messageId: message?.id, reportedUserId: message ? undefined : userId, conversationId, reason, comment: comment || undefined },
      });
      setState('done');
    } catch (e) {
      setState((e as Error).message);
    }
  };

  return (
    <Modal title={message ? 'Report message' : 'Report user'} onClose={onClose}>
      {state === 'done' ? (
        <div className="space-y-3 text-sm">
          <p>Thanks — Support will review this within 24 hours. Until then, don't send money or documents to this person.</p>
          <button onClick={onClose} className="w-full rounded-lg bg-brand-500 py-2 font-semibold text-white">Close</button>
        </div>
      ) : (
        <div className="space-y-3">
          {message?.body && <blockquote className="rounded-lg bg-black/5 px-3 py-2 text-xs text-ink-700">“{message.body.slice(0, 200)}”</blockquote>}
          <fieldset className="space-y-1">
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5">
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-brand-500" />
                {r.label}
              </label>
            ))}
          </fieldset>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2}
            placeholder="Details (optional)" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
          {state !== 'idle' && state !== 'sending' && <p className="text-xs text-red-600">{state}</p>}
          <button onClick={submit} disabled={state === 'sending'} className="w-full rounded-lg bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Send report
          </button>
        </div>
      )}
    </Modal>
  );
}

/** Buyer: propose 1–3 time slots for a viewing / meeting / reservation */
export function MeetingDialog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const send = useChat((s) => s.send);
  const [type, setType] = useState<'SHOWING' | 'MEETING' | 'RESERVATION'>('SHOWING');
  const [slots, setSlots] = useState<string[]>(['', '']);
  const [note, setNote] = useState('');
  const valid = slots.filter(Boolean);

  const submit = async () => {
    await send(conversationId, { kind: 'MEETING_REQUEST', meeting: { type, slots: valid.map((s) => new Date(s).toISOString()), note: note || undefined } });
    onClose();
  };

  return (
    <Modal title="Request a time" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/5 p-1">
          {(['SHOWING', 'MEETING', 'RESERVATION'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded-md py-1.5 text-xs font-medium ${type === t ? 'bg-white shadow' : 'text-ink-500'}`}>
              {t === 'SHOWING' ? 'Viewing' : t === 'MEETING' ? 'Meeting' : 'Reservation'}
            </button>
          ))}
        </div>
        {slots.map((s, i) => (
          <input key={i} type="datetime-local" value={s} min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => setSlots(slots.map((x, j) => (j === i ? e.target.value : x)))}
            className="w-full rounded-lg border border-black/10 px-3 py-2" />
        ))}
        {slots.length < 3 && <button onClick={() => setSlots([...slots, ''])} className="text-xs text-brand-600">+ Add another time</button>}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded-lg border border-black/10 px-3 py-2" />
        <button disabled={!valid.length} onClick={submit} className="w-full rounded-lg bg-brand-500 py-2 font-semibold text-white disabled:opacity-40">
          Send request
        </button>
      </div>
    </Modal>
  );
}

/** Seller: structured terms instead of free-text haggling */
export function OfferDialog({ conversationId, listing, onClose }: { conversationId: string; listing: ListingCard; onClose: () => void }) {
  const send = useChat((s) => s.send);
  const [price, setPrice] = useState(String(Number(listing.price)));
  const [deposit, setDeposit] = useState(listing.type === 'RENT' ? String(Number(listing.price)) : '');
  const [term, setTerm] = useState(listing.type === 'RENT' ? '12' : '');
  const [moveIn, setMoveIn] = useState('');
  const [conditions, setConditions] = useState('');

  const submit = async () => {
    await send(conversationId, {
      kind: 'OFFER',
      offer: {
        price: Number(price),
        currency: listing.currency,
        deposit: deposit ? Number(deposit) : undefined,
        termMonths: term ? Number(term) : undefined,
        moveInDate: moveIn ? new Date(moveIn).toISOString() : undefined,
        conditions: conditions || undefined,
      },
    });
    onClose();
  };

  const field = 'w-full rounded-lg border border-black/10 px-3 py-2';
  return (
    <Modal title="Send terms" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-1">Price ({listing.currency})<input className={field} type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="col-span-1">Deposit<input className={field} type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        {listing.type === 'RENT' && <label>Term, months<input className={field} type="number" value={term} onChange={(e) => setTerm(e.target.value)} /></label>}
        <label>{listing.type === 'RENT' ? 'Move-in' : 'Handover'}<input className={field} type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></label>
        <label className="col-span-2">Conditions<textarea className={field} rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Pets, utilities, furniture…" /></label>
        <button onClick={submit} disabled={!price} className="col-span-2 rounded-lg bg-brand-500 py-2 font-semibold text-white disabled:opacity-40">Send terms</button>
      </div>
    </Modal>
  );
}
