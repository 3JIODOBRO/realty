'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { closeSocket } from '@/lib/socket';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { token, user, logout } = useAuth();
  const connect = useChat((s) => s.connect);
  const loadInbox = useChat((s) => s.loadInbox);
  const unread = useChat((s) => s.conversations.reduce((n, c) => n + c.unread, 0));
  const notices = useChat((s) => s.notices);
  const dismiss = useChat((s) => s.dismissNotice);
  const path = usePathname();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!token) return;
    connect();
    loadInbox().catch(() => {});
  }, [token, connect, loadInbox]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-6 border-b border-black/5 bg-white px-5">
        <Link href="/" className="text-lg font-bold tracking-tight text-brand-600">realty</Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className={clsx(path === '/' ? 'font-semibold' : 'text-ink-500')}>Search</Link>
          <Link href="/inbox" className={clsx('relative', path.startsWith('/inbox') ? 'font-semibold' : 'text-ink-500')}>
            Messages
            {unread > 0 && <span className="absolute -right-5 -top-1 rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
          </Link>
          {hydrated && user?.role !== 'USER' && user?.role && (
            <Link href="/support" className={clsx(path.startsWith('/support') ? 'font-semibold' : 'text-ink-500')}>Support</Link>
          )}
        </nav>
        <div className="ml-auto text-sm">
          {hydrated && user ? (
            <span className="flex items-center gap-3">
              <span className="text-ink-500">{user.name}</span>
              <button onClick={() => { closeSocket(); logout(); location.href = '/'; }} className="text-ink-400 hover:text-ink-900">Log out</button>
            </span>
          ) : (
            <Link href="/login" className="rounded-lg bg-brand-500 px-3 py-1.5 font-semibold text-white">Sign in</Link>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
        {notices.map((n) => (
          <button key={n.id} onClick={() => dismiss(n.id)}
            className={clsx('pointer-events-auto block max-w-sm rounded-xl px-4 py-3 text-left text-sm shadow-lg',
              n.tone === 'error' ? 'bg-red-600 text-white' : n.tone === 'warn' ? 'bg-amber-500 text-white' : 'bg-ink-900 text-white')}>
            {n.text}
          </button>
        ))}
      </div>
    </div>
  );
}
