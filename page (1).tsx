'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

/**
 * Secure deposit checkout. Mount Stripe Elements (@stripe/react-stripe-js) with the clientSecret.
 * Funds are authorized with manual capture and released to the owner after move-in confirmation.
 */
export default function CheckoutPage() {
  const { offerId } = useParams<{ offerId: string }>();
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<{ clientSecret: string }>('/payments/reservations', { method: 'POST', json: { offerMessageId: offerId } })
      .then((r) => setSecret(r.clientSecret))
      .catch((e) => setError(e.message));
  }, [offerId]);

  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Secure reservation deposit</h1>
      <p className="mt-1 text-sm text-ink-500">The deposit is held by the platform and released to the owner only after you confirm move-in.</p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {secret && <div id="stripe-payment-element" data-client-secret={secret} className="mt-4 rounded-lg border border-dashed border-black/10 p-6 text-center text-xs text-ink-400">Stripe Payment Element mounts here</div>}
    </div>
  );
}
