import type { Metadata } from 'next';
import { ArrowLeft, Ticket } from 'lucide-react';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = {
  title: 'Log in | Naija Tickets',
  description: 'Log in to manage your Naija Tickets bookings.',
};

export default function LoginPage() {
  return (
    <main className="auth-shell auth-login-shell grid min-h-screen bg-[#fffaf0] text-[#241b3f] lg:grid-cols-2">
      <section className="auth-visual relative hidden overflow-hidden border-r border-[#241b3f]/10 bg-[#ffd75e] lg:block">
        <img
          src="/auth-login-cartoon.png"
          alt="Cartoon of a guest arriving at a colourful Nigerian music festival"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#130d25]/65 via-transparent to-[#130d25]/25" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <a
            href="/"
            className="flex w-fit items-center gap-2 text-xl text-white [text-shadow:0_2px_18px_rgb(0_0_0/.45)]"
          >
            <Ticket className="h-7 w-7 text-emerald-300" />
            <span className="brand-wordmark">Naija Tickets</span>
          </a>
          <div className="max-w-lg text-white [text-shadow:0_2px_22px_rgb(0_0_0/.55)]">
            <p className="text-xs font-bold uppercase tracking-[.15em] text-[#ffd75e]">
              Welcome back
            </p>
            <h2 className="mt-3 text-5xl font-black leading-tight tracking-[-.04em]">
              Your next experience is waiting.
            </h2>
            <p className="mt-4 max-w-md text-white/90">
              Keep every booking, ticket and event update in one secure place.
            </p>
          </div>
        </div>
      </section>
      <section className="auth-content flex items-center justify-center px-4 py-6 sm:px-10 sm:py-12">
        <div className="auth-form-surface w-full max-w-md">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </a>
          <div className="mt-7 sm:mt-12">
            <p className="eyebrow">Customer access</p>
            <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
              Log in
            </h1>
            <p className="mt-3 text-slate-600">
              Manage your bookings and download your tickets.
            </p>
            <AuthForm mode="login" />
            <p className="mt-7 text-center text-sm text-slate-600">
              New to Naija Tickets?{' '}
              <a
                href="/signup"
                className="inline-flex min-h-11 items-center font-bold text-emerald-700 hover:text-emerald-600"
              >
                Create an account
              </a>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
