'use client';

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  MailCheck,
  UserRound,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GoogleAuthButton } from '@/components/google-auth-button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type AccountType = 'individual' | 'organisation';
const steps = ['Type of account', 'About you', 'Email confirmation'];

export function SignupWizard() {
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [complete, setComplete] = useState(false);
  const [profile, setProfile] = useState({
    name: '',
    organisation: '',
    phone: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const update = (key: keyof typeof profile, value: string) =>
    setProfile((current) => ({ ...current, [key]: value }));

  const submitDetails = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setError('');
    setIsSubmitting(true);

    try {
      const { data, error: authError } =
        await getSupabaseBrowserClient().auth.signUp({
          email: profile.email,
          password: profile.password,
          options: {
            emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
            data: {
              full_name: profile.name,
              phone: profile.phone,
              account_type: accountType,
              organisation_name:
                accountType === 'organisation' ? profile.organisation : null,
            },
          },
        });

      if (authError) throw authError;
      if (data.session) setComplete(true);
      else setStep(3);
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : 'We could not create your account. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithGoogle = async () => {
    setError('');
    if (
      profile.name.trim().length < 2 ||
      profile.phone.trim().length < 7 ||
      (accountType === 'organisation' &&
        profile.organisation.trim().length < 2) ||
      !acceptedTerms
    ) {
      setError(
        'Add your name, phone number and accept the terms before continuing with Google.',
      );
      return;
    }
    setIsSubmitting(true);
    try {
      window.localStorage.setItem(
        'naija-tickets-google-profile',
        JSON.stringify({
          full_name: profile.name.trim(),
          phone: profile.phone.trim(),
          account_type: accountType,
          organisation_name:
            accountType === 'organisation'
              ? profile.organisation.trim()
              : null,
        }),
      );
      const { error: oauthError } =
        await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/login?oauth=1&next=${encodeURIComponent('/organiser')}`,
          },
        });
      if (oauthError) throw oauthError;
    } catch (oauthError) {
      window.localStorage.removeItem('naija-tickets-google-profile');
      setError(
        oauthError instanceof Error
          ? oauthError.message
          : 'Google signup could not be started.',
      );
      setIsSubmitting(false);
    }
  };

  if (complete) {
    return (
      <div className="animate-rise border border-emerald-500/30 bg-emerald-50 p-7">
        <span className="grid h-12 w-12 place-items-center bg-emerald-500 text-emerald-950">
          <Check className="h-6 w-6" />
        </span>
        <p className="eyebrow mt-6">Email confirmed</p>
        <h2 className="mt-2 text-3xl font-black">Your account is ready.</h2>
        <p className="mt-3 leading-7 text-slate-600">
          Continue to your organiser workspace to create events, set ticket
          prices and manage sales as{' '}
          {accountType === 'organisation' ? 'an organisation' : 'an individual'}
          .
        </p>
        <a
          href="/organiser"
          className="mt-6 inline-flex items-center gap-2 bg-[#ff6b4a] px-5 py-3 font-bold text-white"
        >
          Open organiser workspace
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <ol className="grid grid-cols-3" aria-label="Account creation progress">
        {steps.map((label, index) => {
          const number = index + 1;
          const active = number === step;
          const done = number < step;
          return (
            <li key={label} className="relative">
              <div
                className={`absolute left-0 right-0 top-3.5 h-px ${done || active ? 'bg-emerald-500' : 'bg-[#241b3f]/15'} ${index === 0 ? 'left-1/2' : ''} ${index === 2 ? 'right-1/2' : ''}`}
              />
              <div className="relative flex flex-col items-center text-center">
                <span
                  className={`grid h-7 w-7 place-items-center border text-xs font-black ${done ? 'border-emerald-500 bg-emerald-500 text-emerald-950' : active ? 'border-[#ff6b4a] bg-[#ff6b4a] text-white' : 'border-[#241b3f]/15 bg-[#fffaf0] text-slate-400'}`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : number}
                </span>
                <span
                  className={`mt-2 text-[11px] font-bold sm:text-xs ${active ? 'text-[#241b3f]' : 'text-slate-400'}`}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <section className="animate-rise mt-9">
          <h2 className="text-xl font-black">How will you organise events?</h2>
          <p className="mt-2 text-sm text-slate-600">
            Both account types can create events, set ticket prices and manage
            sales. Choose the identity guests should see.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAccountType('individual')}
              className={`p-5 text-left shadow-sm transition ${accountType === 'individual' ? 'border-2 border-emerald-500 bg-emerald-50' : 'border border-[#241b3f]/10 bg-white hover:border-emerald-400'}`}
            >
              <UserRound className="h-5 w-5 text-emerald-600" />
              <span className="mt-4 block font-black">Individual</span>
              <span className="mt-1 block text-xs leading-5 text-slate-600">
                Create and organise events in your own name.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setAccountType('organisation')}
              className={`p-5 text-left shadow-sm transition ${accountType === 'organisation' ? 'border-2 border-[#ff6b4a] bg-[#fff0eb]' : 'border border-[#241b3f]/10 bg-white hover:border-[#ff6b4a]'}`}
            >
              <Building2 className="h-5 w-5 text-[#ff6b4a]" />
              <span className="mt-4 block font-black">Organisation</span>
              <span className="mt-1 block text-xs leading-5 text-slate-600">
                Create and organise events for a company, group or collective.
              </span>
            </button>
          </div>
          <Button
            onClick={() => setStep(2)}
            className="mt-6 h-12 w-full bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535]"
          >
            Continue <ArrowRight className="ml-2" />
          </Button>
        </section>
      )}

      {step === 2 && (
        <form onSubmit={submitDetails} className="animate-rise mt-9 space-y-5">
          <div>
            <h2 className="text-xl font-black">
              Tell us about{' '}
              {accountType === 'organisation'
                ? 'your organisation'
                : 'yourself'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Add all your account details here. The final step only confirms
              your email.
            </p>
          </div>
          {accountType === 'organisation' && (
            <div>
              <label htmlFor="organisation" className="auth-label">
                Organisation name
              </label>
              <Input
                id="organisation"
                required
                value={profile.organisation}
                onChange={(event) => update('organisation', event.target.value)}
                placeholder="Your organisation"
                className="auth-input"
              />
            </div>
          )}
          <div>
            <label htmlFor="full-name" className="auth-label">
              {accountType === 'organisation'
                ? 'Primary contact name'
                : 'Full name'}
            </label>
            <Input
              id="full-name"
              required
              minLength={2}
              autoComplete="name"
              value={profile.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="Your full name"
              className="auth-input"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="auth-label">
                Phone number
              </label>
              <Input
                id="phone"
                required
                type="tel"
                autoComplete="tel"
                value={profile.phone}
                onChange={(event) => update('phone', event.target.value)}
                placeholder="+234 800 000 0000"
                className="auth-input"
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="auth-label">
                Email address
              </label>
              <Input
                id="signup-email"
                required
                type="email"
                autoComplete="email"
                value={profile.email}
                onChange={(event) => update('email', event.target.value)}
                placeholder="you@example.com"
                className="auth-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="signup-password" className="auth-label">
              Create password
            </label>
            <Input
              id="signup-password"
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={profile.password}
              onChange={(event) => update('password', event.target.value)}
              placeholder="At least 8 characters"
              className="auth-input"
            />
          </div>
          <label className="flex gap-3 text-sm leading-6 text-slate-600">
            <input
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 h-4 w-4 accent-emerald-500"
            />
            I agree to the Terms of Service and Privacy Policy.
          </label>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              className="h-12 border-[#241b3f]/15 bg-white px-5"
            >
              <ArrowLeft /> Back
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 flex-1 bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535]"
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}{' '}
              <ArrowRight />
            </Button>
          </div>
          <div className="flex items-center gap-4" aria-label="Or continue with">
            <span className="h-px flex-1 bg-[#241b3f]/10" />
            <GoogleAuthButton
              label="Sign up with Google"
              onClick={continueWithGoogle}
              disabled={isSubmitting}
            />
            <span className="h-px flex-1 bg-[#241b3f]/10" />
          </div>
          {error && (
            <output className="block border border-red-500/25 bg-red-50 p-3 text-sm leading-6 text-red-700">
              {error}
            </output>
          )}
        </form>
      )}

      {step === 3 && (
        <section className="animate-rise mt-9 space-y-5">
          <div className="border border-emerald-500/25 bg-emerald-50 p-5">
            <MailCheck className="h-6 w-6 text-emerald-600" />
            <h2 className="mt-4 text-xl font-black">Confirm your email</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              We sent a secure confirmation link to{' '}
              <strong className="text-[#241b3f]">{profile.email}</strong>. Open
              it to activate your Naija Tickets account.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(2)}
              className="h-12 border-[#241b3f]/15 bg-white px-5"
            >
              <ArrowLeft /> Back
            </Button>
            <a
              href="/login"
              className="h-12 flex-1 bg-emerald-500 font-black text-emerald-950 hover:bg-emerald-400"
            >
              <span className="flex h-full items-center justify-center gap-2">
                Continue to login <ArrowRight className="h-4 w-4" />
              </span>
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
