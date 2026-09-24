'use client';

import {
  Banknote,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Percent,
  UserRound,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PlatformFeeRule } from '@/lib/checkout';
import { formatNaira } from '@/lib/events';

export function AdminSettings() {
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving'>(
    'loading',
  );
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [feeType, setFeeType] = useState<'percentage' | 'fixed'>('percentage');
  const [percentage, setPercentage] = useState('5');
  const [fixedNairaPerTicket, setFixedNairaPerTicket] = useState('500');
  const [feePassword, setFeePassword] = useState('');
  const [feeStatus, setFeeStatus] = useState<'loading' | 'idle' | 'saving'>(
    'loading',
  );
  const [feeNotice, setFeeNotice] = useState('');
  const [feeError, setFeeError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/admin/settings', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (response.status === 401) {
          setSessionExpired(true);
          return;
        }
        const result = (await response.json()) as {
          username?: string;
          error?: string;
        };
        if (!response.ok || !result.username) {
          throw new Error(
            result.error || 'Admin settings could not be loaded.',
          );
        }
        setUsername(result.username);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Admin settings could not be loaded.',
        );
      } finally {
        setStatus('idle');
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const loadFee = async () => {
      try {
        const response = await fetch('/api/admin/platform-fee', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (response.status === 401) {
          setSessionExpired(true);
          return;
        }
        const result = (await response.json()) as {
          feeRule?: PlatformFeeRule;
          error?: string;
        };
        if (!response.ok || !result.feeRule) {
          throw new Error(result.error || 'Platform fee could not be loaded.');
        }
        setFeeType(result.feeRule.type);
        if (result.feeRule.type === 'percentage') {
          setPercentage(String(result.feeRule.basisPoints / 100));
        } else {
          setFixedNairaPerTicket(
            String(result.feeRule.fixedKoboPerTicket / 100),
          );
        }
      } catch (loadError) {
        setFeeError(
          loadError instanceof Error
            ? loadError.message
            : 'Platform fee could not be loaded.',
        );
      } finally {
        setFeeStatus('idle');
      }
    };
    void loadFee();
  }, []);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setStatus('saving');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
      const result = (await response.json()) as {
        username?: string;
        error?: string;
      };
      if (!response.ok || !result.username) {
        throw new Error(result.error || 'Admin settings could not be saved.');
      }
      setUsername(result.username);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(
        'Admin login details updated. Use them the next time you log in.',
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Admin settings could not be saved.',
      );
    } finally {
      setStatus('idle');
    }
  };

  const saveFee = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setFeeStatus('saving');
    setFeeError('');
    setFeeNotice('');
    try {
      const response = await fetch('/api/admin/platform-fee', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: feeType,
          percentage,
          fixedNairaPerTicket,
          currentPassword: feePassword,
        }),
      });
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
      const result = (await response.json()) as {
        feeRule?: PlatformFeeRule;
        error?: string;
      };
      if (!response.ok || !result.feeRule) {
        throw new Error(result.error || 'Platform fee could not be saved.');
      }
      setFeeType(result.feeRule.type);
      setFeePassword('');
      setFeeNotice(
        'Platform fee updated. New reservations will use this rule immediately.',
      );
    } catch (saveError) {
      setFeeError(
        saveError instanceof Error
          ? saveError.message
          : 'Platform fee could not be saved.',
      );
    } finally {
      setFeeStatus('idle');
    }
  };

  const previewFeeKobo =
    feeType === 'percentage'
      ? Math.max(0, Math.round(2_500_000 * (Number(percentage) || 0) * 0.01))
      : Math.max(0, Math.round((Number(fixedNairaPerTicket) || 0) * 100 * 2));

  if (sessionExpired) {
    return (
      <div className="animate-rise max-w-3xl border border-amber-300 bg-amber-50 p-6 sm:p-8">
        <h1 className="text-2xl font-black">Admin session ended</h1>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Sign in again to view or change admin settings.
        </p>
        <button
          type="button"
          onClick={async () => {
            try {
              await fetch('/api/admin/logout', {
                method: 'POST',
                credentials: 'same-origin',
              });
            } finally {
              window.location.replace('/admin');
            }
          }}
          className="mt-5 inline-flex min-h-11 items-center bg-[#241b3f] px-5 text-sm font-bold text-white"
        >
          Sign in again
        </button>
      </div>
    );
  }

  return (
    <div className="animate-rise max-w-3xl">
      <p className="eyebrow">Account security</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">Settings</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Change your private administrator login ID or password. Your current
        password is required before any update is saved.
      </p>

      <form
        onSubmit={submit}
        className="mt-8 space-y-6 border border-[#241b3f]/10 bg-white p-6 sm:p-8"
      >
        <div>
          <label htmlFor="admin-settings-username" className="auth-label">
            Private login ID
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="admin-settings-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              maxLength={80}
              pattern="[A-Za-z0-9._-]+"
              autoComplete="username"
              disabled={status === 'loading'}
              className="auth-input pl-11"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Letters, numbers, full stops, underscores and hyphens are allowed.
          </p>
        </div>

        <div className="border-t border-[#241b3f]/10 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-black">Password</h2>
              <p className="mt-1 text-xs text-slate-500">
                Leave the new password blank to keep the current password.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPasswords((current) => !current)}
              className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700"
            >
              {showPasswords ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {showPasswords ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="current-admin-password" className="auth-label">
                Current password
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="current-admin-password"
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  className="auth-input pl-11"
                />
              </div>
            </div>
            <div>
              <label htmlFor="new-admin-password" className="auth-label">
                New password
              </label>
              <Input
                id="new-admin-password"
                type={showPasswords ? 'text' : 'password'}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                placeholder="At least 12 characters"
                className="auth-input"
              />
            </div>
            <div>
              <label htmlFor="confirm-admin-password" className="auth-label">
                Confirm new password
              </label>
              <Input
                id="confirm-admin-password"
                type={showPasswords ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={newPassword ? 12 : undefined}
                required={Boolean(newPassword)}
                autoComplete="new-password"
                className="auth-input"
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={status !== 'idle'}
          className="h-12 bg-[#241b3f] px-6 font-black text-white hover:bg-[#342755]"
        >
          <CheckCircle2 className="h-4 w-4" />
          {status === 'saving' ? 'Saving settings...' : 'Save settings'}
        </Button>
        {notice && (
          <output className="block border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800">
            {notice}
          </output>
        )}
        {error && (
          <output className="block border border-red-500/25 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </output>
        )}
      </form>

      <form
        onSubmit={saveFee}
        className="mt-8 space-y-6 border border-[#241b3f]/10 bg-white p-6 sm:p-8"
      >
        <div>
          <p className="eyebrow">Platform revenue</p>
          <h2 className="mt-2 text-2xl font-black">Service fee</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Choose how Naija Tickets earns from new organiser ticket sales.
            Existing orders keep their original stored totals.
          </p>
        </div>

        <fieldset>
          <legend className="auth-label">Fee method</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="platform-fee-type-percentage"
              aria-label="Percentage of ticket subtotal"
              className={`flex min-h-24 cursor-pointer items-start gap-3 border p-4 transition ${feeType === 'percentage' ? 'border-emerald-500 bg-emerald-50' : 'border-[#241b3f]/10'}`}
            >
              <input
                id="platform-fee-type-percentage"
                type="radio"
                name="feeType"
                value="percentage"
                checked={feeType === 'percentage'}
                onChange={() => setFeeType('percentage')}
                className="mt-1 accent-emerald-600"
              />
              <span>
                <span className="flex items-center gap-2 font-black">
                  <Percent className="h-4 w-4 text-emerald-700" /> Percentage
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  A percentage of the ticket subtotal.
                </span>
              </span>
            </label>
            <label
              htmlFor="platform-fee-type-fixed"
              aria-label="Fixed amount per ticket"
              className={`flex min-h-24 cursor-pointer items-start gap-3 border p-4 transition ${feeType === 'fixed' ? 'border-emerald-500 bg-emerald-50' : 'border-[#241b3f]/10'}`}
            >
              <input
                id="platform-fee-type-fixed"
                type="radio"
                name="feeType"
                value="fixed"
                checked={feeType === 'fixed'}
                onChange={() => setFeeType('fixed')}
                className="mt-1 accent-emerald-600"
              />
              <span>
                <span className="flex items-center gap-2 font-black">
                  <Banknote className="h-4 w-4 text-emerald-700" /> Fixed per
                  ticket
                </span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  One NGN amount for every ticket sold.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="auth-label" htmlFor="platform-fee-percentage">
              Percentage
            </label>
            <div className="relative">
              <Input
                id="platform-fee-percentage"
                type="number"
                inputMode="decimal"
                min="0"
                max="25"
                step="0.01"
                required={feeType === 'percentage'}
                disabled={feeType !== 'percentage' || feeStatus === 'loading'}
                value={percentage}
                onChange={(event) => setPercentage(event.target.value)}
                className="auth-input pr-12"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">
                %
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">0% to 25%.</p>
          </div>
          <div>
            <label className="auth-label" htmlFor="platform-fee-fixed">
              Fixed NGN per ticket
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">
                ₦
              </span>
              <Input
                id="platform-fee-fixed"
                type="number"
                inputMode="decimal"
                min="0"
                max="100000"
                step="0.01"
                required={feeType === 'fixed'}
                disabled={feeType !== 'fixed' || feeStatus === 'loading'}
                value={fixedNairaPerTicket}
                onChange={(event) => setFixedNairaPerTicket(event.target.value)}
                className="auth-input pl-9"
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ₦0 to ₦100,000 per ticket.
            </p>
          </div>
        </div>

        <div className="border border-emerald-500/20 bg-emerald-50 p-5">
          <p className="text-xs font-black uppercase tracking-wider text-emerald-800">
            Example
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-950">
            For two tickets with a ₦25,000 subtotal, the buyer’s service fee
            would be <strong>{formatNaira(previewFeeKobo)}</strong> and the
            total would be{' '}
            <strong>{formatNaira(2_500_000 + previewFeeKobo)}</strong>.
          </p>
        </div>

        <div>
          <label className="auth-label" htmlFor="platform-fee-password">
            Current admin password
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              id="platform-fee-password"
              type="password"
              value={feePassword}
              onChange={(event) => setFeePassword(event.target.value)}
              required
              autoComplete="current-password"
              className="auth-input pl-11"
            />
          </div>
        </div>

        <Button
          type="submit"
          disabled={feeStatus !== 'idle'}
          className="h-12 bg-emerald-600 px-6 font-black text-white hover:bg-emerald-700"
        >
          <CheckCircle2 className="h-4 w-4" />
          {feeStatus === 'saving' ? 'Saving fee...' : 'Save service fee'}
        </Button>
        {feeNotice && (
          <output className="block border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800">
            {feeNotice}
          </output>
        )}
        {feeError && (
          <output className="block border border-red-500/25 bg-red-50 p-3 text-sm text-red-700">
            {feeError}
          </output>
        )}
      </form>
    </div>
  );
}
