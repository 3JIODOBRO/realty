'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { ListingCard } from '@/lib/types';
import { ListingsMap } from '@/components/ListingsMap';

export default function SearchPage() {
  const [type, setType] = useState<'RENT' | 'SALE'>('RENT');
  const [q, setQ] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [rooms, setRooms] = useState('');
  const [sort, setSort] = useState('best_value');
  const [items, setItems] = useState<ListingCard[]>([]);
  const [hover, setHover] = useState<string>();

  useEffect(() => {
    const p = new URLSearchParams({ type, sort });
    if (q) p.set('q', q);
    if (maxPrice) p.set('maxPrice', maxPrice);
    if (rooms) p.set('rooms', rooms);
    const t = setTimeout(() => api<ListingCard[]>(`/listings?${p}`).then(setItems).catch(() => setItems([])), 250);
    return () => clearTimeout(t);
  }, [type, q, maxPrice, rooms, sort]);

  return (
    <div className="flex h-full">
      <div className="flex w-full max-w-3xl flex-col">
        <div className="space-y-3 border-b border-black/5 bg-white p-4">
          <div className="flex gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/5 p-1 text-sm">
              {(['RENT', 'SALE'] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={clsx('rounded-md px-4 py-1.5', type === t ? 'bg-white font-semibold shadow' : 'text-ink-500')}>
                  {t === 'RENT' ? 'Rent' : 'Buy'}
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street, district or keyword"
              className="flex-1 rounded-lg border border-black/10 px-3 text-sm" />
          </div>
          <div className="flex gap-2 text-sm">
            <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} type="number" placeholder="Max price" className="w-32 rounded-lg border border-black/10 px-3 py-1.5" />
            <select value={rooms} onChange={(e) => setRooms(e.target.value)} className="rounded-lg border border-black/10 px-2">
              <option value="">Any rooms</option>{[1, 2, 3, 4].map((r) => <option key={r} value={r}>{r} rooms</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="ml-auto rounded-lg border border-black/10 px-2">
              <option value="best_value">Best value (price/m² vs area)</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Cheapest</option>
              <option value="price_desc">Most expensive</option>
            </select>
          </div>
        </div>
        <ul className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 scroll-thin">
          {items.map((l) => (
            <li key={l.id} onMouseEnter={() => setHover(l.id)}>
              <Link href={`/listings/${l.id}`} className="block overflow-hidden rounded-xl bg-white shadow-sm hover:shadow-md">
                <div className="aspect-[4/3] bg-brand-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.photos[0] && <img src={l.photos[0]} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{money(l.price, l.currency, l.rentPeriod)}</span>
                    {l.value_score != null && l.value_score < 0.9 && (
                      <span className="rounded bg-brand-50 px-1.5 text-[11px] font-medium text-brand-700">
                        {Math.round((1 - l.value_score) * 100)}% below area avg
                      </span>
                    )}
                  </div>
                  <div className="truncate text-sm">{l.title}</div>
                  <div className="truncate text-xs text-ink-400">{l.rooms} rooms · {l.areaM2} m² · {l.address}</div>
                </div>
              </Link>
            </li>
          ))}
          {items.length === 0 && <li className="col-span-2 p-10 text-center text-sm text-ink-400">Nothing found — try widening the filters.</li>}
        </ul>
      </div>
      <div className="hidden flex-1 lg:block">
        <ListingsMap listings={items} highlightId={hover} />
      </div>
    </div>
  );
}
