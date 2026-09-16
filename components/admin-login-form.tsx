'use client';

import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AdminLoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const username = formData.get('username');
    const password = formData.get('password');
    if (typeof username !== 'string' || typeof password !== 'string') return;

    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) throw new Error(result.error || 'Login failed.');
      window.location.replace('/admin');
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Login failed. Please try again.',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <label htmlFor="admin-username" className="auth-label">
          Email address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="admin-username"
            name="username"
            required
            autoComplete="username"
            placeholder="you@example.com"
            className="auth-input pl-11"
          />
        </div>
      </div>
      <div>
        <label htmlFor="admin-password" className="auth-label">
          Password
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="admin-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            className="auth-input px-11"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((current) => !current)}
            className="absolute right-0 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center text-slate-500"
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
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full bg-emerald-500 font-black text-emerald-950"
      >
        {isSubmitting ? 'Checking…' : 'Open admin workspace'}
      </Button>
      {error && (
        <output className="block border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
          {error}
        </output>
      )}
    </form>
  );
}
