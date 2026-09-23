'use client';

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  MailCheck,
  TicketCheck,
  UserRound,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GoogleAuthButton } from '@/components/google-auth-button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type AccountType = 'customer' | 'individual' | 'organisation';
const steps = ['Account use', 'About you', 'Email confirmation'];

export function SignupWizard() {
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState<AccountType>('customer');
  const [accountUse, setAccountUse] = useState<'customer' | 'organiser' | null>(
    null,
  );
  const [showOrganiserTypes, setShowOrganiserTypes] = useState(false);
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
              account_type:
                accountType === 'customer' ? 'individual' : accountType,
              account_purpose:
                accountType === 'customer' ? 'customer' : 'organiser',
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
          account_type: accountType === 'customer' ? 'individual' : accountType,
          account_purpose:
            accountType === 'customer' ? 'customer' : 'organiser',
          organisation_name:
            accountType === 'organisation' ? profile.organisation.trim() : null,
        }),
      );
      const { error: oauthError } =
        await getSupabaseBrowserClient().auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/login?oauth=1&next=${encodeURIComponent(accountType === 'customer' ? '/account' : '/organiser')}`,
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
          {accountType === 'customer'
            ? 'Your tickets and signed-in purchases will be saved automatically in your customer account.'
            : `Continue to your organiser workspace to create events, set ticket prices and manage sales as ${accountType === 'organisation' ? 'an organisation' : 'an individual'}.`}
        </p>
        <a
          href={accountType === 'customer' ? '/account' : '/organiser'}
          className="mt-6 inline-flex items-center gap-2 bg-[#ff6b4a] px-5 py-3 font-bold text-white"
        >
          {accountType === 'customer'
            ? 'Open My tickets'
            : 'Open organiser workspace'}
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <ol className="grid grid-cols-3" aria-label="Account creation progress">
        {steps.map((label, index) => {
          const number = index + 1;
          const active = number === step;
          const done = number < step;
          return (
            <li key={label} className="relative">
              <div
                className={`absolute left-0 right-0 top-3 h-px ${done || active ? 'bg-emerald-500' : 'bg-[#241b3f]/15'} ${index === 0 ? 'left-1/2' : ''} ${index === 2 ? 'right-1/2' : ''}`}
              />
              <div className="relative flex flex-col items-center text-center">
                <span
                  className={`grid h-6 w-6 place-items-center border text-xs font-black ${done ? 'border-emerald-500 bg-emerald-500 text-emerald-950' : active ? 'border-[#ff6b4a] bg-[#ff6b4a] text-white' : 'border-[#241b3f]/15 bg-[#fffaf0] text-slate-400'}`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : number}
                </span>
                <span
                  className={`mt-1 text-[11px] font-bold sm:text-xs ${active ? 'text-[#241b3f]' : 'text-slate-400'}`}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <section className="animate-rise mt-6">
          <div className="min-h-52">
            {!showOrganiserTypes ? (
              <>
                <h2 className="text-xl font-black">Choose your account use</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Choose whether you are here to buy tickets or manage events.
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountUse('customer');
                      setAccountType('customer');
                    }}
                    className={`group flex min-h-32 flex-col justify-center p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500 hover:bg-emerald-50 ${accountUse === 'customer' ? 'border-2 border-emerald-500 bg-emerald-50' : 'border border-[#241b3f]/10 bg-white'}`}
                  >
                    <TicketCheck className="h-6 w-6 text-emerald-600 transition group-hover:scale-110" />
                    <span className="mt-4 block text-lg font-black">
                      Buy tickets
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountUse('organiser');
                      setAccountType('individual');
                      setShowOrganiserTypes(true);
                    }}
                    className="group flex min-h-32 flex-col justify-center border border-[#241b3f]/10 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#ff6b4a] hover:bg-[#fff0eb]"
                  >
                    <Building2 className="h-6 w-6 text-[#ff6b4a] transition group-hover:scale-110" />
                    <span className="mt-4 block text-lg font-black">
                      Organise events
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setShowOrganiserTypes(false);
                    setAccountUse(null);
                    setAccountType('customer');
                  }}
                  className="inline-flex min-h-9 items-center gap-2 text-sm font-bold text-emerald-700"
                >
                  <ArrowLeft className="h-4 w-4" /> Account use
                </button>
                <h2 className="mt-2 text-xl font-black">
                  How will you organise events?
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('individual')}
                    className={`group flex min-h-32 flex-col justify-center p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-500 ${accountType === 'individual' ? 'border-2 border-emerald-500 bg-emerald-50' : 'border border-[#241b3f]/10 bg-white'}`}
                  >
                    <UserRound className="h-6 w-6 text-emerald-600 transition group-hover:scale-110" />
                    <span className="mt-3 block text-lg font-black">
                      Individual
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('organisation')}
                    className={`group flex min-h-32 flex-col justify-center p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#ff6b4a] ${accountType === 'organisation' ? 'border-2 border-[#ff6b4a] bg-[#fff0eb]' : 'border border-[#241b3f]/10 bg-white'}`}
                  >
                    <Building2 className="h-6 w-6 text-[#ff6b4a] transition group-hover:scale-110" />
                    <span className="mt-3 block text-lg font-black">
                      Organisation
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <Button
            disabled={!accountUse}
            onClick={() => setStep(2)}
            className="mt-5 h-11 w-full bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535] disabled:bg-slate-300 disabled:text-slate-600"
          >
            Continue <ArrowRight className="ml-2" />
          </Button>
        </section>
      )}

      {step === 2 && (
        <form onSubmit={submitDetails} className="animate-rise mt-4 space-y-3">
          <div>
            <h2 className="text-xl font-black">
              Tell us about{' '}
              {accountType === 'organisation'
                ? 'your organisation'
                : 'yourself'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Add all your account details here. The final step only confirms
              your email.
            </p>
          </div>
          <div
            className={
              accountType === 'organisation'
                ? 'grid gap-3 sm:grid-cols-2'
                : undefined
            }
          >
            {accountType === 'organisation' && (
              <div>
                <label
                  htmlFor="organisation"
                  className="auth-label !mb-1 !text-xs"
                >
                  Organisation name
                </label>
                <Input
                  id="organisation"
                  required
                  value={profile.organisation}
                  onChange={(event) =>
                    update('organisation', event.target.value)
                  }
                  placeholder="Your organisation"
                  className="auth-input !h-10 !min-h-10"
                />
              </div>
            )}
            <div>
              <label htmlFor="full-name" className="auth-label !mb-1 !text-xs">
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
                className="auth-input !h-10 !min-h-10"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="phone" className="auth-label !mb-1 !text-xs">
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
                className="auth-input !h-10 !min-h-10"
              />
            </div>
            <div>
              <label
                htmlFor="signup-email"
                className="auth-label !mb-1 !text-xs"
              >
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
                className="auth-input !h-10 !min-h-10"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="signup-password"
              className="auth-label !mb-1 !text-xs"
            >
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
              className="auth-input !h-10 !min-h-10"
            />
          </div>
          <div className="flex gap-3 text-xs leading-5 text-slate-600">
            <input
              id="accept-legal-terms"
              type="checkbox"
              required
              aria-label="I agree to the Terms of Service and Privacy Policy"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 h-4 w-4 accent-emerald-500"
            />
            <p>
              I agree to the{' '}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-emerald-700 underline"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-emerald-700 underline"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              className="h-10 border-[#241b3f]/15 bg-white px-5"
            >
              <ArrowLeft /> Back
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-10 flex-1 bg-[#ff6b4a] font-black text-white hover:bg-[#ee5535]"
            >
              {isSubmitting ? 'Creating account…' : 'Create account'}{' '}
              <ArrowRight />
            </Button>
          </div>
          <div
            className="flex items-center gap-3"
            aria-label="Or continue with"
          >
            <span className="h-px flex-1 bg-[#241b3f]/10" />
            <GoogleAuthButton
              label="Sign up with Google"
              onClick={continueWithGoogle}
              disabled={isSubmitting}
              className="h-10 w-10"
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
        <section className="animate-rise mt-4 space-y-3">
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
