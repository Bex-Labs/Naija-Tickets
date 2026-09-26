'use client';
import { useState, type SyntheticEvent } from 'react';
import { Input } from '@/components/ui/input';

export function GroupClaimForm({
  token,
  remaining,
}: {
  token: string;
  remaining: number;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!remaining)
    return (
      <p className="mt-6 border border-emerald-500/25 bg-white p-5 font-bold">
        All tickets in this group have been claimed.
      </p>
    );
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !event.currentTarget.reportValidity()) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/group-bookings/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          phone: form.get('phone'),
        }),
      });
      const body = (await response.json()) as {
        ticketPath?: string;
        error?: string;
      };
      if (!response.ok || !body.ticketPath)
        throw new Error(body.error || 'Unable to claim this ticket.');
      window.location.assign(body.ticketPath);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to claim this ticket.',
      );
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="mt-7 space-y-5 border border-[#241b3f]/10 bg-white p-6 sm:p-8"
    >
      <h2 className="text-xl font-black">Register for your admission</h2>
      <label className="auth-label" htmlFor="group-claim-name">
        Full name
        <Input
          id="group-claim-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          className="auth-input mt-2 w-full"
          disabled={saving}
        />
      </label>
      <label className="auth-label" htmlFor="group-claim-email">
        Email
        <Input
          id="group-claim-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          className="auth-input mt-2 w-full"
          disabled={saving}
        />
      </label>
      <label className="auth-label" htmlFor="group-claim-phone">
        Phone number
        <Input
          id="group-claim-phone"
          name="phone"
          type="tel"
          required
          minLength={7}
          maxLength={40}
          autoComplete="tel"
          className="auth-input mt-2 w-full"
          disabled={saving}
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="min-h-12 w-full bg-[#ff6b4a] px-5 font-black text-white disabled:opacity-50"
      >
        {saving ? 'Claiming your ticket…' : 'Claim My Ticket'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
