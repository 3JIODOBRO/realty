'use client';
import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { emitAck, getSocket } from '@/lib/socket';
import type { ChatMessage, ConversationSummary, MessageStatus } from '@/lib/types';
import { useAuth } from './auth';

const RANK: Record<MessageStatus, number> = { failed: -2, blocked: -1, pending: 0, sent: 1, delivered: 2, read: 3 };

export interface SendInput {
  kind: ChatMessage['kind'];
  body?: string;
  meeting?: { type: 'SHOWING' | 'MEETING' | 'RESERVATION'; slots: string[]; note?: string };
  offer?: { price: number; currency: string; deposit?: number; termMonths?: number; moveInDate?: string; conditions?: string };
  attachmentIds?: string[];
  templateId?: string;
}

interface SendResult { message?: ChatMessage; blocked?: boolean; notice?: string; error?: string }

interface Notice { id: string; text: string; tone: 'info' | 'warn' | 'error' }

interface ChatState {
  socket: Socket | null;
  connected: boolean;
  conversations: ConversationSummary[];
  messages: Record<string, ChatMessage[]>;
  typing: Record<string, boolean>;
  activeId: string | null;
  notices: Notice[];

  connect: () => void;
  loadInbox: () => Promise<void>;
  open: (conversationId: string) => Promise<void>;
  close: () => void;
  send: (conversationId: string, input: SendInput) => Promise<void>;
  retry: (conversationId: string, clientId: string) => Promise<void>;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  markRead: (conversationId: string) => void;
  dismissNotice: (id: string) => void;
}

const pendingInputs = new Map<string, SendInput>();

export const useChat = create<ChatState>((set, get) => ({
  socket: null,
  connected: false,
  conversations: [],
  messages: {},
  typing: {},
  activeId: null,
  notices: [],

  connect: () => {
    const token = useAuth.getState().token;
    if (!token || get().socket) return;
    const s = getSocket(token);
    set({ socket: s });

    s.on('connect', () => {
      set({ connected: true });
      get().loadInbox(); // catch up after reconnect
      const id = get().activeId;
      if (id) get().open(id);
    });
    s.on('disconnect', () => set({ connected: false }));

    s.on('message:new', (m: ChatMessage) => {
      upsertMessage(set, get, m);
      if (!m.mine && m.senderId) {
        // ✓✓ for the sender: the message reached this device
        s.emit('message:delivered', { conversationId: m.conversationId, upTo: m.createdAt });
        if (get().activeId === m.conversationId && document.visibilityState === 'visible') get().markRead(m.conversationId);
      }
      bumpConversation(set, get, m);
    });

    s.on('receipt', (r: { conversationId: string; kind: 'delivered' | 'read'; upTo: string }) => {
      set((st) => ({
        messages: {
          ...st.messages,
          [r.conversationId]: (st.messages[r.conversationId] ?? []).map((m) =>
            m.mine && m.status && RANK[m.status] >= RANK.sent && RANK[m.status] < RANK[r.kind] && m.createdAt <= r.upTo
              ? { ...m, status: r.kind } : m),
        },
        conversations: st.conversations.map((c) =>
          c.id === r.conversationId && c.lastMessage?.mine && c.lastMessage.createdAt <= r.upTo
            ? { ...c, lastMessage: { ...c.lastMessage, status: r.kind } } : c),
      }));
    });

    s.on('message:updated', (u: { conversationId: string; id: string; payload: ChatMessage['payload'] }) => {
      set((st) => ({
        messages: { ...st.messages, [u.conversationId]: (st.messages[u.conversationId] ?? []).map((m) => (m.id === u.id ? { ...m, payload: u.payload } : m)) },
      }));
    });

    s.on('message:hidden', (h: { conversationId: string; messageId: string; reason?: string }) => {
      set((st) => ({
        messages: {
          ...st.messages,
          [h.conversationId]: (st.messages[h.conversationId] ?? []).map((m) =>
            m.id === h.messageId ? { ...m, hidden: true, body: null, attachments: [], safetyTip: h.reason } : m),
        },
      }));
    });

    s.on('message:flagged', (f: { conversationId: string; messageId: string; safetyTip: string }) => {
      set((st) => ({
        messages: {
          ...st.messages,
          [f.conversationId]: (st.messages[f.conversationId] ?? []).map((m) => (m.id === f.messageId && !m.mine ? { ...m, verdict: 'WARN', safetyTip: f.safetyTip } : m)),
        },
      }));
    });

    s.on('typing', (t: { conversationId: string; isTyping: boolean }) => {
      set((st) => ({ typing: { ...st.typing, [t.conversationId]: t.isTyping } }));
      if (t.isTyping) setTimeout(() => set((st) => ({ typing: { ...st.typing, [t.conversationId]: false } })), 5000);
    });

    s.on('notification', (n: { id: string; type: string; data: { buyerName?: string; listingTitle?: string; hours?: number } }) => {
      if (n.type === 'UNANSWERED_CONVERSATION') {
        pushNotice(set, `${n.data.buyerName} has been waiting ${n.data.hours} h for your reply about “${n.data.listingTitle}”`, 'warn');
        get().loadInbox();
      }
    });

    s.on('error', (e: { message: string }) => pushNotice(set, e.message, 'error'));
  },

  loadInbox: async () => {
    const conversations = await api<ConversationSummary[]>('/conversations');
    set({ conversations });
  },

  open: async (conversationId) => {
    set({ activeId: conversationId });
    const history = await api<ChatMessage[]>(`/conversations/${conversationId}/messages?limit=100`);
    set((st) => {
      // keep optimistic messages that the server doesn't know about yet
      const local = (st.messages[conversationId] ?? []).filter((m) => m.status === 'pending' || m.status === 'failed');
      return { messages: { ...st.messages, [conversationId]: [...history, ...local] } };
    });
    get().markRead(conversationId);
  },

  close: () => set({ activeId: null }),

  send: async (conversationId, input) => {
    const s = get().socket;
    const me = useAuth.getState().user;
    if (!me) return;
    const clientId = crypto.randomUUID();
    pendingInputs.set(clientId, input);
    const optimistic: ChatMessage = {
      id: `tmp-${clientId}`,
      clientId,
      conversationId,
      senderId: me.id,
      kind: input.kind,
      body: input.body ?? null,
      payload: input.meeting ? { ...input.meeting, status: 'PENDING' } : input.offer ? { ...input.offer, status: 'PENDING' } : null,
      attachments: [],
      createdAt: new Date().toISOString(),
      verdict: 'ALLOW',
      mine: true,
      status: 'pending',
    };
    upsertMessage(set, get, optimistic);
    await deliver(set, get, s, conversationId, clientId, input);
  },

  retry: async (conversationId, clientId) => {
    const input = pendingInputs.get(clientId);
    if (!input) return;
    setStatus(set, conversationId, clientId, 'pending');
    await deliver(set, get, get().socket, conversationId, clientId, input);
  },

  setTyping: (conversationId, isTyping) => get().socket?.emit('typing', { conversationId, isTyping }),

  markRead: (conversationId) => {
    const list = get().messages[conversationId] ?? [];
    const lastIncoming = [...list].reverse().find((m) => !m.mine && m.senderId);
    if (!lastIncoming) return;
    get().socket?.emit('message:read', { conversationId, upTo: lastIncoming.createdAt });
    set((st) => ({ conversations: st.conversations.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)) }));
  },

  dismissNotice: (id) => set((st) => ({ notices: st.notices.filter((n) => n.id !== id) })),
}));

type Set = (fn: (s: ChatState) => Partial<ChatState>) => void;
type Get = () => ChatState;

async function deliver(set: Set, get: Get, s: Socket | null, conversationId: string, clientId: string, input: SendInput) {
  try {
    const payload = { conversationId, clientId, ...input };
    const res: SendResult = s?.connected
      ? await emitAck<SendResult>(s, 'message:send', payload)
      : await api<SendResult>(`/conversations/${conversationId}/messages`, { method: 'POST', json: payload });
    if (res.error) throw new Error(res.error);
    if (res.message) upsertMessage(set, get, { ...res.message, mine: true, notice: res.notice });
    if (res.blocked) pushNotice(set, res.notice ?? 'Message was blocked by safety rules', 'error');
    pendingInputs.delete(clientId);
  } catch (e) {
    setStatus(set, conversationId, clientId, 'failed');
    pushNotice(set, (e as Error).message, 'error');
  }
}

function upsertMessage(set: Set, _get: Get, m: ChatMessage) {
  set((st) => {
    const list = st.messages[m.conversationId] ?? [];
    const idx = list.findIndex((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId));
    let next: ChatMessage[];
    if (idx >= 0) {
      const prev = list[idx];
      // never downgrade a status that a receipt already upgraded
      const status = prev.status && m.status && RANK[prev.status] > RANK[m.status] && m.status !== 'blocked' ? prev.status : m.status;
      next = [...list];
      next[idx] = { ...prev, ...m, status };
    } else {
      next = [...list, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return { messages: { ...st.messages, [m.conversationId]: next } };
  });
}

function bumpConversation(set: Set, get: Get, m: ChatMessage) {
  const exists = get().conversations.some((c) => c.id === m.conversationId);
  if (!exists) {
    get().loadInbox();
    return;
  }
  set((st) => ({
    conversations: st.conversations
      .map((c) => c.id === m.conversationId
        ? { ...c, lastMessage: m, unread: !m.mine && st.activeId !== c.id ? c.unread + 1 : c.unread, awaitingReplyFrom: m.mine ? (c.myRole === 'BUYER' ? 'SELLER' : 'BUYER') : c.myRole }
        : c)
      .sort((a, b) => (b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessage?.createdAt ?? '')),
  }));
}

function setStatus(set: Set, conversationId: string, clientId: string, status: MessageStatus) {
  set((st) => ({
    messages: { ...st.messages, [conversationId]: (st.messages[conversationId] ?? []).map((m) => (m.clientId === clientId ? { ...m, status } : m)) },
  }));
}

function pushNotice(set: Set, text: string, tone: Notice['tone']) {
  const id = Math.random().toString(36).slice(2);
  set((st) => ({ notices: [...st.notices, { id, text, tone }] }));
  setTimeout(() => set((st) => ({ notices: st.notices.filter((n) => n.id !== id) })), 7000);
}
