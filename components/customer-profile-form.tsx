'use client';

import { Mail, Phone, Save, UserRound } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import type { CustomerProfile } from '@/lib/customer-account';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function CustomerProfileForm({
  profile,
  onSaved,
}: {
  profile: CustomerProfile;
  onSaved: (profile: CustomerProfile) => void;
}) {
  const [fullName, setFullName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session)
        throw new Error('Your session has expired. Log in again.');
      const response = await fetch('/api/customer/account', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fullName, phone }),
      });
      const result = (await response.json()) as {
        profile?: CustomerProfile;
        error?: string;
      };
      if (!response.ok || !result.profile) {
        throw new Error(result.error || 'Your profile could not be saved.');
      }
      setFullName(result.profile.name);
      setPhone(result.profile.phone);
      onSaved(result.profile);
      setNotice('Profile saved. Future checkouts will use these details.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your profile could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'mt-2 min-h-12 w-full border border-[#241b3f]/20 bg-white px-4 text-sm outline-none transition focus:border-emerald-500';

  return (
    <form
      onSubmit={submit}
      className="grid gap-5 border border-[#241b3f]/10 bg-white p-5 shadow-sm sm:grid-cols-2 sm:p-7"
    >
      <div className="sm:col-span-2">
        <p className="eyebrow">Account details</p>
        <h2 className="mt-2 text-3xl font-black tracking-[-.03em]">
          My profile
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          These details prefill checkout when you buy tickets while signed in.
        </p>
      </div>
      <label className="text-sm font-bold" htmlFor="customer-full-name">
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-emerald-700" /> Full name
        </span>
        <input
          id="customer-full-name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          disabled={saving}
          className={fieldClass}
        />
      </label>
      <label className="text-sm font-bold" htmlFor="customer-phone">
        <span className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-emerald-700" /> Phone number
        </span>
        <input
          id="customer-phone"
          required
          minLength={7}
          maxLength={40}
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={saving}
          className={fieldClass}
        />
      </label>
      <label
        className="text-sm font-bold sm:col-span-2"
        htmlFor="customer-email"
      >
        <span className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-emerald-700" /> Sign-in email
        </span>
        <input
          id="customer-email"
          value={profile.email}
          readOnly
          type="email"
          className={`${fieldClass} cursor-not-allowed bg-slate-50 text-slate-500`}
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Your verified sign-in email cannot be changed here.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-5 text-sm font-black text-emerald-950 disabled:opacity-60"
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save profile'}
        </button>
        {notice && (
          <output className="text-sm font-bold text-emerald-700">
            {notice}
          </output>
        )}
        {error && (
          <p role="alert" className="text-sm font-bold text-red-700">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
