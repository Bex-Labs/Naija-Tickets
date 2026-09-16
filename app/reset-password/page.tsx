import type { Metadata } from 'next';
import { ArrowLeft, Ticket } from 'lucide-react';
import { ResetPasswordForm } from '@/components/reset-password-form';

export const metadata: Metadata = {
  title: 'Set a new password | Naija Tickets',
  description: 'Choose a new password for your Naija Tickets account.',
};

export default function ResetPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-5 py-12 text-[#241b3f]">
      <section className="w-full max-w-md border border-[#241b3f]/10 bg-white p-7 shadow-xl sm:p-10">
        <a
          href="/"
          className="flex min-h-11 w-fit items-center gap-2 text-xl font-black"
        >
          <span className="grid h-8 w-8 place-items-center bg-emerald-500 text-emerald-950">
            <Ticket className="h-4 w-4" />
          </span>
          Naija Tickets
        </a>
        <a
          href="/login"
          className="mt-10 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600 hover:text-emerald-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </a>
        <p className="eyebrow mt-10">Account recovery</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
          Set a new password
        </h1>
        <p className="mt-3 text-slate-600">
          Choose a secure password with at least eight characters.
        </p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
