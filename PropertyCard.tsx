import Link from 'next/link';
import clsx from 'clsx';
import { money } from '@/lib/format';
import type { ListingCard, ParticipantRole } from '@/lib/types';

const STATUS: Record<ListingCard['status'], { label: string; cls: string }> = {
  ACTIVE: { label: 'Available', cls: 'bg-brand-50 text-brand-700' },
  RESERVED: { label: 'Reserved', cls: 'bg-amber-50 text-amber-700' },
  CLOSED: { label: 'Closed', cls: 'bg-ink-400/10 text-ink-500' },
  DRAFT: { label: 'Draft', cls: 'bg-ink-400/10 text-ink-500' },
};

/** Pinned at the top of every conversation: the chat is always about this property. */
export function PropertyCard({ listing, myRole, onRequestShowing, onSendOffer }: {
  listing: ListingCard;
  myRole: ParticipantRole;
  onRequestShowing?: () => void;
  onSendOffer?: () => void;
}) {
  const st = STATUS[listing.status];
  return (
    <div className="flex items-center gap-3 border-b border-black/5 bg-white px-4 py-3">
      <Link href={`/listings/${listing.id}`} className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-100">
        {listing.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.photos[0]} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-brand-700">{listing.rooms} rm</div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium', st.cls)}>{st.label}</span>
          <span className="text-[11px] uppercase tracking-wide text-ink-400">{listing.type === 'RENT' ? 'For rent' : 'For sale'}</span>
        </div>
        <Link href={`/listings/${listing.id}`} className="block truncate text-sm font-semibold hover:underline">{listing.title}</Link>
        <div className="truncate text-xs text-ink-500">
          {money(listing.price, listing.currency, listing.rentPeriod)} · {listing.areaM2} m² · {listing.address}
        </div>
      </div>
      {myRole === 'BUYER' && onRequestShowing && listing.status === 'ACTIVE' && (
        <button onClick={onRequestShowing} className="shrink-0 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600">
          Request viewing
        </button>
      )}
      {myRole === 'SELLER' && onSendOffer && (
        <button onClick={onSendOffer} className="shrink-0 rounded-lg border border-brand-500 px-3 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-50">
          Send terms
        </button>
      )}
    </div>
  );
}
