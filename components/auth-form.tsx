'use client';

import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GoogleAuthButton } from '@/components/google-auth-button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === 'signup';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('confirmed') === '1') {
      window.setTimeout(
        () => setNotice('Email confirmed. Log in to continue.'),
        0,
      );
    }

    if (params.get('oauth') !== '1') return;
    const finishGoogleLogin = async () => {
      setIsSubmitting(true);
      setError('');
      try {
        const client = getSupabaseBrowserClient();
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          throw new Error('Google login could not be completed. Try again.');
        }

        const pending = window.localStorage.getItem(
          'naija-tickets-google-profile',
        );
        if (pending) {
          const profile = JSON.parse(pending) as {
            full_name: string;
            phone: string;
            account_type: 'individual' | 'organisation';
            organisation_name: string | null;
          };
          const { error: metadataError } = await client.auth.updateUser({
            data: profile,
          });
          if (metadataError) throw metadataError;
          const { error: profileError } = await client
            .from('profiles')
            .update({
              full_name: profile.full_name,
              phone: profile.phone,
              updated_at: new Date().toISOString(),
            })
            .eq('id', data.session.user.id);
          if (profileError) throw profileError;
          window.localStorage.removeItem('naija-tickets-google-profile');
        }

        setNotice('Google login successful. Opening your workspace...');
        const requestedPath = params.get('next');
        window.location.replace(
          requestedPath?.startsWith('/checkout/')
            ? requestedPath
            : '/organiser',
        );
      } catch (oauthError) {
        setError(
          oauthError instanceof Error
            ? oauthError.message
            : 'Google login could not be completed.',
        );
        setIsSubmitting(false);
      }
    };
    void finishGoogleLogin();
  }, []);

  const continueWithGoogle = async () => {
    setError('');
    setNotice('');
    setIsSubmitting(true);
    try {
      const requestedPath = new URLSearchParams(window.location.search).get(
        'next',
      );
      const next = requestedPath?.startsWith('/checkout/')
        ? requestedPath
        : '/organiser';
      const { error: oauthError } =
        await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/login?oauth=1&next=${encodeURIComponent(next)}`,
          },
        });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      setError(
        oauthError instanceof Error
          ? oauthError.message
          : 'Google login could not be started.',
      );
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (isSignup) {
      setNotice(
        'Your details look good. Continue through the account setup steps.',
      );
      return;
    }

    const data = new FormData(form);
    const identifier = data.get('email');
    const password = data.get('password');
    if (typeof identifier !== 'string' || typeof password !== 'string') return;
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      if (!identifier.includes('@')) {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: identifier, password }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(
            result.error || 'The email address or password is incorrect.',
          );
        }

        setNotice('Login successful. Opening the admin dashboard...');
        window.location.href = '/admin';
        return;
      }

      const { error: authError } =
        await getSupabaseBrowserClient().auth.signInWithPassword({
          email: identifier,
          password,
        });

      if (authError) throw authError;
      setNotice('Login successful. Opening your workspace...');
      const requestedPath = new URLSearchParams(window.location.search).get(
        'next',
      );
      window.location.href = requestedPath?.startsWith('/checkout/')
        ? requestedPath
        : '/organiser';
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : 'We could not log you in. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      {isSignup && (
        <div>
          <label
            htmlFor="name"
            className="mb-2 block text-sm font-bold text-[#241b3f]"
          >
            Full name
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              minLength={2}
              placeholder="Your full name"
              className="h-12 border-[#241b3f]/15 bg-white pl-11 text-[#241b3f] placeholder:text-slate-400"
            />
          </div>
        </div>
      )}
      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-sm font-bold text-[#241b3f]"
        >
          Email address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="email"
            name="email"
            type={isSignup ? 'email' : 'text'}
            autoComplete={isSignup ? 'email' : 'username'}
            required
            placeholder="you@example.com"
            className="h-12 border-[#241b3f]/15 bg-white pl-11 text-[#241b3f] placeholder:text-slate-400"
          />
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="password"
            className="text-sm font-bold text-[#241b3f]"
          >
            Password
          </label>
          {!isSignup && (
            <a
              href="/forgot-password"
              className="inline-flex min-h-11 items-center text-xs font-bold text-emerald-700 hover:text-emerald-600"
            >
              Forgot password?
            </a>
          )}
        </div>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={8}
            placeholder="At least 8 characters"
            className="h-12 border-[#241b3f]/15 bg-white px-11 text-[#241b3f] placeholder:text-slate-400"
          />
          <button
            type="button"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword(!showPassword)}
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
      {isSignup && (
        <label className="flex gap-3 text-sm leading-6 text-slate-600">
          <input
            type="checkbox"
            required
            className="mt-1 h-4 w-4 accent-emerald-500"
          />
          I agree to the Terms of Service and Privacy Policy.
        </label>
      )}
      <Button
        type="submit"
        disabled={isSubmitting}
        className="h-12 w-full bg-[#ff6b4a] text-sm font-black text-white hover:bg-[#ee5535]"
      >
        {isSubmitting ? 'Logging in…' : isSignup ? 'Create account' : 'Log in'}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
      {!isSignup && (
        <div className="flex items-center gap-4" aria-label="Or continue with">
          <span className="h-px flex-1 bg-[#241b3f]/10" />
          <GoogleAuthButton
            label="Log in with Google"
            onClick={continueWithGoogle}
            disabled={isSubmitting}
          />
          <span className="h-px flex-1 bg-[#241b3f]/10" />
        </div>
      )}
      {notice && (
        <output className="block border border-emerald-500/25 bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">
          {notice}
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
