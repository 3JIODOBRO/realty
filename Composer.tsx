'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api, uploadAttachment } from '@/lib/api';
import { bytes } from '@/lib/format';
import type { ParticipantRole, QuickReply } from '@/lib/types';
import { useChat } from '@/store/chat';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf,.doc,.docx,.xls,.xlsx,.txt';
const MAX = { image: 15 * 1024 * 1024, doc: 25 * 1024 * 1024 };

interface Pending { file: File; progress: number; id?: string; error?: string }

export function Composer({ conversationId, myRole, disabled }: { conversationId: string; myRole: ParticipantRole; disabled?: boolean }) {
  const send = useChat((s) => s.send);
  const setTyping = useChat((s) => s.setTyping);
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState<string>();
  const [files, setFiles] = useState<Pending[]>([]);
  const [templates, setTemplates] = useState<QuickReply[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (myRole === 'SELLER') api<QuickReply[]>('/templates').then(setTemplates).catch(() => {});
  }, [myRole]);

  const onChange = (v: string) => {
    setText(v);
    setTyping(conversationId, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(conversationId, false), 2000);
  };

  const pick = async (list: FileList | null) => {
    if (!list) return;
    const added: Pending[] = Array.from(list).slice(0, 10).map((file) => {
      const limit = file.type.startsWith('image/') ? MAX.image : MAX.doc;
      return { file, progress: 0, error: file.size > limit ? `Max ${bytes(limit)}` : undefined };
    });
    setFiles((f) => [...f, ...added]);
    for (const p of added.filter((a) => !a.error)) {
      try {
        const res = await uploadAttachment(conversationId, p.file, (progress) =>
          setFiles((all) => all.map((x) => (x.file === p.file ? { ...x, progress } : x))));
        setFiles((all) => all.map((x) => (x.file === p.file ? { ...x, id: res.id, progress: 1, error: res.status !== 'READY' ? 'Rejected' : undefined } : x)));
      } catch (e) {
        setFiles((all) => all.map((x) => (x.file === p.file ? { ...x, error: (e as Error).message } : x)));
      }
    }
  };

  const applyTemplate = async (t: QuickReply) => {
    const r = await api<{ text: string; templateId: string }>(`/templates/${t.id}/render?conversationId=${conversationId}`);
    setText(r.text);
    setTemplateId(r.templateId);
    setShowTemplates(false);
  };

  const ready = files.filter((f) => f.id && !f.error);
  const uploading = files.some((f) => !f.id && !f.error);
  const canSend = !disabled && !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = async () => {
    if (!canSend) return;
    const body = text.trim() || undefined;
    const attachmentIds = ready.map((f) => f.id!);
    setText('');
    setFiles([]);
    setTemplateId(undefined);
    setTyping(conversationId, false);
    await send(conversationId, { kind: attachmentIds.length ? 'ATTACHMENT' : 'TEXT', body, attachmentIds, templateId });
  };

  return (
    <div className="border-t border-black/5 bg-white">
      {myRole === 'SELLER' && templates.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 scroll-thin">
          {templates.slice(0, 4).map((t) => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              className="shrink-0 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs text-brand-700 hover:bg-brand-100">
              {t.title}
            </button>
          ))}
          <button onClick={() => setShowTemplates((v) => !v)} className="shrink-0 rounded-full px-2 py-1 text-xs text-ink-500 hover:bg-black/5">
            All templates…
          </button>
        </div>
      )}
      {showTemplates && (
        <div className="mx-3 mt-2 max-h-56 overflow-y-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg scroll-thin">
          {templates.map((t) => (
            <button key={t.id} onClick={() => applyTemplate(t)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-black/5">
              <div className="text-xs font-semibold">{t.title} <span className="font-normal text-ink-400">· {t.category}</span></div>
              <div className="line-clamp-2 text-xs text-ink-500">{t.body}</div>
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-2">
          {files.map((f, i) => (
            <div key={i} className={clsx('relative w-44 rounded-lg border px-2 py-1.5 text-xs', f.error ? 'border-red-200 bg-red-50' : 'border-black/10')}>
              <div className="truncate font-medium">{f.file.name}</div>
              <div className="text-ink-400">{f.error ?? (f.id ? bytes(f.file.size) : `${Math.round(f.progress * 100)}%`)}</div>
              {!f.id && !f.error && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-500" style={{ width: `${f.progress * 100}%` }} />}
              <button onClick={() => setFiles((all) => all.filter((x) => x !== f))} className="absolute right-1 top-1 text-ink-400 hover:text-ink-900">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        <button onClick={() => fileInput.current?.click()} disabled={disabled} title="Attach photos or documents"
          className="rounded-lg p-2 text-ink-500 hover:bg-black/5 disabled:opacity-40">
          <svg viewBox="0 0 20 20" className="h-5 w-5"><path d="M14.5 9.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5l6-6a2.1 2.1 0 013 3l-6 6a1 1 0 01-1.5-1.5l5.3-5.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <textarea
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          placeholder={disabled ? 'This conversation is closed' : 'Write a message…'}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl bg-[#f3f4f2] px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <button onClick={submit} disabled={!canSend}
          className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}
