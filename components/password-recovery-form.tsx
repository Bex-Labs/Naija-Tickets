'use client';

import { Mail, Send } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function PasswordRecoveryForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const email = new FormData(form).get('email');
    if (typeof email !== 'string') return;

    setError('');
    setIsSubmitting(true);

    try {
      const { error: recoveryError } =
        await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });

      if (recoveryError) throw recoveryError;
      setSent(true);
    } catch (recoveryError) {
      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : 'We could not send the recovery email. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="recovery-email" className="auth-label">
          Email address
        </label>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="recovery-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="auth-input pl-11"
          />
        </div>
      </div>
      <Button
        disabled={isSubmitting}
        className="h-12 w-full bg-emerald-500 font-black text-emerald-950"
      >
        {isSubmitting ? 'Sending…' : 'Send recovery link'}
        <Send />
      </Button>
      {sent && (
        <output className="block border border-emerald-500/25 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
          If an account exists for that address, a Naija Tickets recovery link
          is on its way.
        </output>
      )}
      {error && (
        <output className="block border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
          {error}
        </output>
      )}
    </form>
  );
}
