'use client';

import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VerificationRequest } from '@/lib/organiser-verification';

export function AdminOrganiserVerification() {
  const [organisers, setOrganisers] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/organiser-verification', {
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          organisers?: VerificationRequest[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error || 'Verification requests could not be loaded.',
          );
        setOrganisers(result.organisers || []);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Verification requests could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const decide = async (organiserId: string, approved: boolean) => {
    setBusyId(organiserId);
    setError('');
    setNotice('');
    const wasVerified =
      organisers.find((item) => item.organiserId === organiserId)?.status ===
      'verified';
    try {
      const response = await fetch('/api/admin/organiser-verification', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organiserId,
          approved,
          note: notes[organiserId] || '',
        }),
      });
      const result = (await response.json()) as {
        organisers?: VerificationRequest[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || 'Review could not be saved.');
      setOrganisers(result.organisers || []);
      setNotice(
        approved
          ? 'Organiser verified.'
          : wasVerified
            ? 'Verification revoked.'
            : 'Verification rejected.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Review could not be saved.',
      );
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="mt-10" aria-labelledby="organiser-verification-heading">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-emerald-600" />
        <h2 id="organiser-verification-heading" className="text-2xl font-black">
          Organiser verification
        </h2>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Confirm submitted NIN or CAC details through an authorised source before
        approval. Matching the number format alone does not verify identity.
      </p>
      {loading ? (
        <p className="mt-5 text-sm">Loading requests…</p>
      ) : (
        <div className="mt-5 space-y-4">
          {organisers.map((organiser) => (
            <article
              key={organiser.organiserId}
              className="border border-[#241b3f]/10 bg-white p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <img
                  src={
                    organiser.accountType === 'individual'
                      ? '/nimc-logo.svg'
                      : '/cac-logo.png'
                  }
                  alt={
                    organiser.accountType === 'individual'
                      ? 'NIMC emblem'
                      : 'CAC emblem'
                  }
                  className="h-10 w-20 object-contain"
                />
                <h3 className="font-black">{organiser.name}</h3>
                {organiser.verifiedAt && (
                  <BadgeCheck
                    className="h-5 w-5 fill-emerald-500 text-white"
                    aria-label="Verified organiser"
                  />
                )}
                <span className="bg-[#fff3d8] px-2 py-1 text-xs font-bold capitalize">
                  {organiser.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {organiser.accountType} · {organiser.contactEmail} ·{' '}
                {organiser.phone || 'No phone'}
              </p>
              {organiser.submittedAt ? (
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <p>
                    <strong>Legal name:</strong> {organiser.legalName}
                  </p>
                  <p>
                    <strong>
                      {organiser.accountType === 'organisation'
                        ? 'CAC registration number'
                        : 'NIN'}
                      :
                    </strong>{' '}
                    {organiser.registrationReference}
                  </p>
                  <p className="text-xs text-slate-600">
                    Submitted{' '}
                    {new Date(organiser.submittedAt).toLocaleDateString(
                      'en-NG',
                    )}
                  </p>
                  {organiser.reviewNote && (
                    <p className="text-xs text-slate-600">
                      Review note: {organiser.reviewNote}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  No verification details submitted.
                </p>
              )}
              {(organiser.status === 'pending' ||
                organiser.status === 'verified') && (
                <div className="mt-4 space-y-3">
                  <label
                    className="block text-sm font-bold"
                    htmlFor={`verification-note-${organiser.organiserId}`}
                  >
                    Review note (required for rejection or revocation)
                  </label>
                  <textarea
                    id={`verification-note-${organiser.organiserId}`}
                    maxLength={1000}
                    value={notes[organiser.organiserId] || ''}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [organiser.organiserId]: event.target.value,
                      }))
                    }
                    className="min-h-20 w-full border border-[#241b3f]/15 p-3 text-sm"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={
                        busyId === organiser.organiserId ||
                        (notes[organiser.organiserId] || '').trim().length < 3
                      }
                      onClick={() => void decide(organiser.organiserId, false)}
                      className="min-h-11 border border-red-500/30 px-4 text-sm font-bold text-red-700 disabled:opacity-50"
                    >
                      {organiser.status === 'verified'
                        ? 'Revoke verification'
                        : 'Reject'}
                    </button>
                    {organiser.status === 'pending' && (
                      <button
                        type="button"
                        disabled={busyId === organiser.organiserId}
                        onClick={() => void decide(organiser.organiserId, true)}
                        className="min-h-11 bg-emerald-500 px-4 text-sm font-bold text-emerald-950 disabled:opacity-50"
                      >
                        Verify organiser
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          ))}
          {!organisers.length && (
            <p className="text-sm text-slate-600">No organisers yet.</p>
          )}
        </div>
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
