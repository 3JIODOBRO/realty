'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ConversationList } from '@/components/chat/ConversationList';
import { useAuth } from '@/store/auth';

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const token = useAuth((s) => s.token);
  if (!token) {
    return (
      <div className="mt-20 text-center text-sm">
        <Link href="/login" className="text-brand-600 underline">Sign in</Link> to see your conversations.
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <aside className="w-[340px] shrink-0 border-r border-black/5 bg-white">
        <ConversationList activeId={params.id} />
      </aside>
      {children}
    </div>
  );
}
