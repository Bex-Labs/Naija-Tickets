'use client';

import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrganiserVerificationState } from '@/lib/organiser-verification';

export function OrganiserVerification() {
  const [verification, setVerification] =
    useState<OrganiserVerificationState | null>(null);
  const [legalName, setLegalName] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session) throw new Error('Your session has expired.');
        const response = await fetch('/api/organiser/verification', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          verification?: OrganiserVerificationState;
          error?: string;
        };
        if (!response.ok || !result.verification)
          throw new Error(result.error || 'Verification could not be loaded.');
        setError('');
        setVerification(result.verification);
        setLegalName(result.verification.legalName);
        setReference(result.verification.registrationReference);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Verification could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener('organiser-verification-decision', refresh);
    return () =>
      window.removeEventListener('organiser-verification-decision', refresh);
  }, []);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error('Your session has expired.');
      const response = await fetch('/api/organiser/verification', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ legalName, registrationReference: reference }),
      });
      const result = (await response.json()) as {
        verification?: OrganiserVerificationState;
        error?: string;
      };
      if (!response.ok || !result.verification)
        throw new Error(result.error || 'Submission failed.');
      setVerification(result.verification);
      setReference(result.verification.registrationReference);
      setNotice('Verification details submitted for administrator review.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 border border-[#241b3f]/10 bg-white p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-emerald-600" />
        <h2 className="text-xl font-black">Organiser verification</h2>
        {verification?.verified && (
          <BadgeCheck
            className="h-5 w-5 fill-emerald-500 text-white"
            aria-label="Verified organiser"
          />
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Individuals submit their NIN; organisations submit their CAC
        registration number. Only administrators can review these details.
        Verification is required before a new event can be published.
      </p>
      {loading ? (
        <p className="mt-5 text-sm">Loading verification…</p>
      ) : (
        verification && (
          <>
            <p className="mt-4 text-sm font-bold text-emerald-800">
              Status:{' '}
              {verification.verified
                ? 'Verified'
                : verification.status === 'pending'
                  ? 'Awaiting review'
                  : verification.status === 'rejected'
                    ? 'Rejected'
                    : 'Not verified'}
            </p>
            {verification.reviewNote && (
              <p className="mt-2 text-sm text-slate-600">
                Review note: {verification.reviewNote}
              </p>
            )}
            {verification.accountType === 'individual' &&
              verification.referenceLast4 && (
                <p className="mt-2 text-xs text-slate-600">
                  NIN ending in {verification.referenceLast4} is on file. Enter
                  all 11 digits again to update your submission.
                </p>
              )}
            {!verification.verified && (
              <form
                onSubmit={submit}
                className="mt-5 grid gap-4 sm:grid-cols-2"
              >
                <div className="sm:col-span-2 flex items-center gap-4 rounded-lg border border-emerald-500/20 bg-emerald-50 p-3">
                  <img
                    src={
                      verification.accountType === 'individual'
                        ? '/nimc-logo.svg'
                        : '/cac-logo.png'
                    }
                    alt={
                      verification.accountType === 'individual'
                        ? 'NIMC emblem'
                        : 'CAC emblem'
                    }
                    className="h-14 w-28 object-contain"
                  />
                  <div>
                    <p className="text-sm font-black text-emerald-950">
                      {verification.accountType === 'individual'
                        ? 'National Identity Management Commission (NIMC)'
                        : 'Corporate Affairs Commission (CAC)'}
                    </p>
                    <p className="mt-1 text-xs text-emerald-900/80">
                      {verification.accountType === 'individual'
                        ? 'Use the 11-digit NIN issued to you.'
                        : 'Use the registration number on your CAC record.'}
                    </p>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="verification-legal-name"
                    className="auth-label"
                  >
                    Legal name
                  </label>
                  <input
                    id="verification-legal-name"
                    className="auth-input"
                    required
                    minLength={2}
                    maxLength={120}
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="verification-reference"
                    className="auth-label"
                  >
                    {verification.accountType === 'organisation'
                      ? 'CAC registration number'
                      : 'National Identification Number (NIN)'}
                  </label>
                  <input
                    id="verification-reference"
                    className="auth-input"
                    type={
                      verification.accountType === 'individual'
                        ? 'password'
                        : 'text'
                    }
                    inputMode={
                      verification.accountType === 'individual'
                        ? 'numeric'
                        : 'text'
                    }
                    autoComplete="off"
                    pattern={
                      verification.accountType === 'individual'
                        ? '[0-9]{11}'
                        : undefined
                    }
                    title={
                      verification.accountType === 'individual'
                        ? 'Enter exactly 11 digits.'
                        : undefined
                    }
                    required
                    minLength={
                      verification.accountType === 'individual' ? 11 : 3
                    }
                    maxLength={
                      verification.accountType === 'individual' ? 11 : 40
                    }
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-11 bg-emerald-500 px-5 text-sm font-black text-emerald-950 disabled:opacity-50 sm:w-fit"
                >
                  {saving
                    ? 'Submitting…'
                    : verification.status === 'pending'
                      ? 'Update submission'
                      : 'Submit for verification'}
                </button>
              </form>
            )}
          </>
        )
      )}
      {notice && (
        <output className="mt-4 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
