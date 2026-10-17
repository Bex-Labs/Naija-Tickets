'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckoutFlow, type CheckoutLine } from './checkout-flow';
import type { CheckoutReservation } from '@/lib/checkout-service';

type Model = {
  sessionId: string;
  status: string;
  environment: 'test' | 'live';
  promoCode: string | null;
  event: {
    id: string;
    title: string;
    slug: string;
    starts_at: string;
    timezone: string;
    venue_name: string;
    city: string;
  };
  lines: CheckoutLine[];
  reservation: CheckoutReservation | null;
  subtotal: number;
  fee: number;
};
type PaystackConstructor = new () => {
  resumeTransaction(
    code: string,
    options: { onSuccess(): void; onCancel(): void; onError(): void },
  ): void;
};
declare global {
  interface Window {
    PaystackPop?: PaystackConstructor;
  }
}
let providerLoading: Promise<PaystackConstructor> | undefined;
function loadProvider() {
  if (window.PaystackPop) return Promise.resolve(window.PaystackPop);
  if (!providerLoading)
    providerLoading = new Promise<PaystackConstructor>((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(
          new Error('The payment window took too long to load. Try again.'),
        );
      }, 20000);
      script.src = 'https://js.paystack.co/v2/inline.js';
      script.onload = () => {
        clearTimeout(timer);
        if (window.PaystackPop) resolve(window.PaystackPop);
        else reject(new Error('Payment window unavailable.'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(
          new Error(
            'Could not load the secure payment window. Check your connection.',
          ),
        );
      };
      document.head.appendChild(script);
    }).catch((error) => {
      providerLoading = undefined;
      throw error;
    });
  return providerLoading;
}
export function EmbeddedCheckout({ sessionId }: { sessionId: string }) {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState('');
  const [frameAccess, setFrameAccess] = useState({ access: '', permit: '' });
  const [checking, setChecking] = useState(false);
  const [paymentStarted, setPaymentStarted] = useState(false);
  const credentials = useRef({ access: '', permit: '', parent: '' });
  const read = useCallback(
    async (action = 'popup') => {
      const response = await fetch(
        `/api/integrations/checkout/${sessionId}/${action}`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access: credentials.current.access,
            permit: credentials.current.permit,
          }),
        },
      );
      const result = (await response.json()) as Model & { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Checkout unavailable.');
      setModel(result);
      return result as Model;
    },
    [sessionId],
  );
  useEffect(() => {
    const url = new URL(location.href);
    credentials.current.access ||=
      new URLSearchParams(url.hash.slice(1)).get('access') ?? '';
    credentials.current.permit = url.searchParams.get('permit') ?? '';
    history.replaceState(null, '', url.pathname + url.search);
    setFrameAccess({
      access: credentials.current.access,
      permit: credentials.current.permit,
    });
    let active = true;
    void read()
      .then(() => {
        if (!active) return;
        const payload = credentials.current.permit.split('.')[0];
        credentials.current.parent = JSON.parse(
          atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
        ).parent;
      })
      .catch(() => {
        if (active)
          setError(
            'Checkout unavailable. Close this window and start again from the original website.',
          );
      });
    return () => {
      active = false;
    };
    // The capability is read once from the fragment, never from browser storage.
  }, [read]);
  const paid = model?.status === 'paid';
  async function verify() {
    setChecking(true);
    setError('');
    try {
      const result = await read('verify');
      if (result.status !== 'paid')
        setError(
          'Payment is not confirmed yet. If you have paid, wait a moment and check again.',
        );
    } catch {
      setError(
        'We could not confirm payment yet. Check again before starting another purchase.',
      );
    } finally {
      setChecking(false);
    }
  }
  function complete() {
    if (!paid || !credentials.current.parent) return;
    window.parent.postMessage(
      {
        type: 'naija.checkout.complete',
        sessionId,
        channel: credentials.current.permit,
      },
      credentials.current.parent,
    );
  }
  async function pay(result: {
    completed?: boolean;
    authorizationUrl?: string;
  }) {
    setPaymentStarted(true);
    if (result.completed) {
      await verify();
      return;
    }
    const url = new URL(result.authorizationUrl ?? '');
    if (
      url.origin !== 'https://checkout.paystack.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9_-]{6,128}$/.test(url.pathname)
    )
      throw new Error('Invalid payment session.');
    const Paystack = await loadProvider();
    await new Promise<void>((resolve, reject) => {
      new Paystack().resumeTransaction(url.pathname.slice(1), {
        onSuccess: () => {
          void verify().finally(resolve);
        },
        onCancel: () => {
          resolve();
        },
        onError: () => {
          reject(
            new Error(
              'The secure payment window could not be opened. Try again.',
            ),
          );
        },
      });
    });
  }
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <header className="flex items-center justify-between gap-3 border-b border-[#241b3f]/10 bg-white px-5 py-4">
        <strong>
          Naija Tickets{' '}
          <span className="font-normal text-slate-500">· Secure checkout</span>
        </strong>
        {model?.environment === 'test' && (
          <span className="text-xs font-bold text-amber-800">TEST MODE</span>
        )}
      </header>
      {!model && !error && (
        <output className="block p-6">Preparing your booking…</output>
      )}
      {paid ? (
        <section className="p-6 sm:p-8">
          <p className="text-sm font-bold text-emerald-700">Payment verified</p>
          <h1 className="mt-3 text-3xl font-black">
            You’re going to {model.event.title}.
          </h1>
          <p className="mt-4 text-sm leading-6">
            Your tickets are ready. Group admissions stay reserved until each
            member claims their ticket.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {model.reservation && (
              <a
                className="inline-flex min-h-11 items-center border border-emerald-600 px-4 font-bold text-emerald-800"
                href={`/payment/status?reference=${encodeURIComponent(model.reservation.reference)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View tickets & group links ↗
              </a>
            )}
            <button
              className="min-h-11 bg-emerald-600 px-4 font-bold text-white"
              onClick={complete}
            >
              Return to website
            </button>
          </div>
        </section>
      ) : model &&
        !['expired', 'cancelled', 'refunded', 'partially_refunded'].includes(
          model.status,
        ) ? (
        <CheckoutFlow
          embedded
          eventId={model.event.id}
          eventSlug={model.event.slug}
          eventTitle={model.event.title}
          eventDate={new Date(model.event.starts_at).toLocaleString('en-NG', {
            timeZone: model.event.timezone,
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          eventVenue={`${model.event.venue_name}, ${model.event.city}`}
          lines={model.lines}
          subtotalKobo={model.subtotal}
          feeKobo={model.fee}
          hostedCheckout={{
            sessionId,
            access: frameAccess.access,
            permit: frameAccess.permit,
            promoCode: model.promoCode,
          }}
          initialReservation={model.reservation}
          onPayment={pay}
        />
      ) : (
        model && (
          <p className="p-6">
            This booking is {model.status}. Close this window to return to the
            website.
          </p>
        )
      )}
      {paymentStarted && !paid && (
        <div className="px-5 pb-5">
          <button
            className="min-h-11 underline font-bold text-emerald-800"
            disabled={checking}
            onClick={() => void verify()}
          >
            {checking
              ? 'Verifying payment…'
              : 'Already paid? Check payment status'}
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="m-5 border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
    </main>
  );
}
