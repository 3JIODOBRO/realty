'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { ListingCard } from '@/lib/types';
import { useAuth } from '@/store/auth';

type Listing = ListingCard & { description: string; owner: { id: string; name: string; createdAt: string } };

const STARTERS = ['Is it still available?', 'When can I come for a viewing?', 'Are utilities included?', 'Is the price negotiable?'];

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [l, setL] = useState<Listing>();
  const [similar, setSimilar] = useState<ListingCard[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Listing>(`/listings/${id}`).then(setL);
    api<ListingCard[]>(`/listings/${id}/similar`).then(setSimilar).catch(() => {});
  }, [id]);

  const contact = async () => {
    if (!user) return router.push('/login');
    try {
      const r = await api<{ conversation: { id: string } }>('/conversations', { method: 'POST', json: { listingId: id, message: text || undefined } });
      router.push(`/inbox/${r.conversation.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!l) return <div className="p-10 text-center text-sm text-ink-400">Loading…</div>;
  const mine = user?.id === l.owner.id;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div>
        <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-brand-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {l.photos[0] && <img src={l.photos[0]} alt="" className="h-full w-full object-cover" />}
        </div>
        <h1 className="mt-4 text-2xl font-semibold">{l.title}</h1>
        <p className="text-ink-500">{l.address}, {l.city}</p>
        <div className="mt-3 flex gap-4 text-sm">
          <span className="text-xl font-semibold">{money(l.price, l.currency, l.rentPeriod)}</span>
          <span className="self-end text-ink-500">{l.rooms} rooms · {l.areaM2} m² · {money(Number(l.price) / l.areaM2, l.currency)}/m²</span>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{l.description}</p>
        {similar.length > 0 && (
          <>
            <h2 className="mt-8 font-semibold">Similar nearby</h2>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {similar.map((s) => (
                <Link key={s.id} href={`/listings/${s.id}`} className="rounded-xl bg-white p-3 text-sm shadow-sm hover:shadow">
                  <div className="font-semibold">{money(s.price, l.currency)}</div>
                  <div className="truncate text-xs text-ink-500">{s.title}</div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <aside className="h-fit rounded-2xl bg-white p-5 shadow-sm lg:sticky lg:top-6">
        <div className="text-sm text-ink-500">Owner</div>
        <div className="font-semibold">{l.owner.name}</div>
        <div className="text-xs text-ink-400">On the platform since {new Date(l.owner.createdAt).getFullYear()}</div>
        {mine ? (
          <Link href="/inbox" className="mt-4 block rounded-lg bg-ink-900 py-2.5 text-center text-sm font-semibold text-white">Open your conversations</Link>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => setText(s)} className="rounded-full bg-black/5 px-2.5 py-1 text-xs hover:bg-black/10">{s}</button>
              ))}
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Your question to the owner"
              className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
            <button onClick={contact} className="mt-2 w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              Message the owner
            </button>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <p className="mt-3 text-[11px] leading-snug text-ink-400">
              Never pay before a viewing or outside the platform. Deposits made through the secure checkout are held until you move in.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
