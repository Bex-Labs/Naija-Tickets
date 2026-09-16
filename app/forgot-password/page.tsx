import type { Metadata } from 'next';
import { ArrowLeft, Ticket } from 'lucide-react';
import { PasswordRecoveryForm } from '@/components/password-recovery-form';

export const metadata: Metadata = {
  title: 'Recover password | Naija Tickets',
  description: 'Request a Naija Tickets password recovery link.',
};
export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-5 py-12 text-[#241b3f]">
      <div className="w-full max-w-md">
        <a
          href="/"
          className="flex min-h-11 items-center gap-2 text-xl font-black"
        >
          <span className="grid h-8 w-8 place-items-center bg-emerald-500 text-emerald-950">
            <Ticket className="h-4 w-4" />
          </span>
          Naija Tickets
        </a>
        <a
          href="/login"
          className="mt-12 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600 hover:text-[#241b3f]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </a>
        <p className="eyebrow mt-10">Account recovery</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-.04em]">
          Reset your password
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          Enter your account email and we’ll send a secure recovery link.
        </p>
        <PasswordRecoveryForm />
      </div>
    </main>
  );
}
