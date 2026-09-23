import type { Metadata } from 'next';
import { ArrowLeft, ShieldCheck, Ticket, Zap } from 'lucide-react';
import { SignupWizard } from '@/components/signup-wizard';

export const metadata: Metadata = {
  title: 'Create an account | Naija Tickets',
  description: 'Create your Naija Tickets account.',
};

export default function SignupPage() {
  return (
    <main className="auth-shell auth-signup-shell grid min-h-screen bg-[#fffaf0] text-[#241b3f] lg:h-dvh lg:min-h-0 lg:grid-cols-2 lg:overflow-hidden">
      <section className="auth-visual relative hidden overflow-hidden border-l border-[#241b3f]/10 bg-[#ffdc70] lg:order-2 lg:block lg:h-dvh">
        <img
          src="/auth-signup-cartoon.png"
          alt="Cartoon of Nigerian guests and an organiser celebrating at a city event"
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
              One account, every event
            </p>
            <h2 className="mt-3 text-5xl font-black leading-tight tracking-[-.04em]">
              Show up without the stress.
            </h2>
            <div className="mt-7 space-y-3 text-sm text-white/90">
              <p className="flex items-center gap-3">
                <Zap className="h-4 w-4 text-emerald-400" />
                Fast, clear checkout
              </p>
              <p className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Event tools for individuals and organisations
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="auth-content flex items-center justify-center px-4 py-6 sm:px-10 sm:py-12 lg:order-1 lg:h-dvh lg:items-start lg:overflow-y-auto lg:px-8 lg:py-3">
        <div className="auth-form-surface my-auto w-full max-w-2xl">
          <a
            href="/"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </a>
          <div className="mt-3 lg:mt-2">
            <p className="eyebrow">Join Naija Tickets</p>
            <h1 className="mt-1 text-3xl font-black tracking-[-.04em]">
              Create your account
            </h1>
            <SignupWizard />
            <p className="mt-2 text-center text-sm text-slate-600">
              Already have an account?{' '}
              <a
                href="/login"
                className="inline-flex min-h-9 items-center px-2 font-bold text-emerald-700 hover:text-emerald-600"
              >
                Log in
              </a>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
