'use client';
import { useParams } from 'next/navigation';
import { ChatWindow } from '@/components/chat/ChatWindow';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <ChatWindow conversationId={id} />;
}
