'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import type { User } from '@/lib/types';

const DEMO = ['buyer@demo.dev', 'seller@demo.dev', 'support@demo.dev'];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const setSession = useAuth((s) => s.setSession);
  const router = useRouter();

  const login = async (e: string) => {
    try {
      const r = await api<{ token: string; user: User }>('/auth/dev-login', { method: 'POST', json: { email: e } });
      setSession(r.token, r.user);
      router.push('/inbox');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="mx-auto mt-20 max-w-sm rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-xs text-ink-400">Development login. Replace with your identity provider in production.</p>
      <form onSubmit={(e) => { e.preventDefault(); login(email); }} className="mt-4 space-y-3">
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="you@example.com"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
        <button className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white">Continue</button>
      </form>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {DEMO.map((d) => <button key={d} onClick={() => login(d)} className="rounded-full bg-black/5 px-2.5 py-1 text-xs">{d}</button>)}
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}
