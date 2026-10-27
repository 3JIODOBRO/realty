import clsx from 'clsx';
import type { MessageStatus as Status } from '@/lib/types';

const LABEL: Record<Status, string> = {
  pending: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent — tap to retry',
  blocked: 'Not delivered — blocked by safety rules',
};

/** ✓ sent · ✓✓ delivered · blue ✓✓ read */
export function MessageStatus({ status, onRetry }: { status: Status; onRetry?: () => void }) {
  if (status === 'pending') {
    return (
      <svg aria-label={LABEL.pending} viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-400">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'failed' || status === 'blocked') {
    return (
      <button type="button" onClick={onRetry} disabled={status === 'blocked'} title={LABEL[status]} aria-label={LABEL[status]}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
        !
      </button>
    );
  }
  const double = status !== 'sent';
  return (
    <svg aria-label={LABEL[status]} viewBox="0 0 20 12" className={clsx('h-3 w-[18px]', status === 'read' ? 'text-read' : 'text-ink-400')}>
      <title>{LABEL[status]}</title>
      <path d="M1.5 6.5l3.2 3.2L11 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {double && <path d="M7.8 9.4l.3.3L14.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
