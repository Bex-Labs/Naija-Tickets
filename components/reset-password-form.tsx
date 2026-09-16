'use client';

import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function ResetPasswordForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const password = new FormData(form).get('password');
    if (typeof password !== 'string') return;

    setNotice('');
    setError('');
    setIsSubmitting(true);

    try {
      const { error: updateError } =
        await getSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      setNotice('Your password has been updated. You can now log in.');
      form.reset();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'We could not update your password. Request a new recovery link.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="new-password" className="auth-label">
          New password
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="new-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            minLength={8}
            required
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="auth-input px-11"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((current) => !current)}
            className="absolute right-0 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center text-slate-500 hover:text-[#241b3f]"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <Button
        disabled={isSubmitting}
        className="h-12 w-full bg-emerald-500 font-black text-emerald-950"
      >
        {isSubmitting ? 'Updating…' : 'Update password'}
      </Button>
      {notice && (
        <output className="block border border-emerald-500/25 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
          {notice}{' '}
          <a href="/login" className="font-black underline">
            Log in
          </a>
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
