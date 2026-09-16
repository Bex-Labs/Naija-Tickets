'use client';

import {
  CheckCircle2,
  Landmark,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Bank = { name: string; code: string };
type Payout = {
  bankCode: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
  enabled: boolean;
  updatedAt: string;
};
type Verification = {
  accountName: string;
  accountLast4: string;
  bankCode: string;
  bankName: string;
};

async function accessToken() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error('Your session has expired. Log in again.');
  return data.session.access_token;
}

export function OrganiserPayoutSettings() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const token = await accessToken();
        const response = await fetch('/api/organiser/payout-account', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = (await response.json()) as {
          banks?: Bank[];
          payout?: Payout | null;
          error?: string;
        };
        if (!response.ok || !result.banks) {
          throw new Error(result.error || 'Payout settings could not be loaded.');
        }
        setBanks(result.banks);
        setPayout(result.payout || null);
        setBankCode(result.payout?.bankCode || '');
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Payout settings could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const resetVerification = () => {
    setVerification(null);
    setNotice('');
    setError('');
  };

  const verifyAccount = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/organiser/payout-account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bankCode, accountNumber }),
      });
      const result = (await response.json()) as {
        verification?: Verification;
        error?: string;
      };
      if (!response.ok || !result.verification) {
        throw new Error(result.error || 'The account could not be verified.');
      }
      setVerification(result.verification);
      setNotice('Account verified. Confirm the name before connecting it.');
    } catch (verifyError) {
      setVerification(null);
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : 'The account could not be verified.',
      );
    } finally {
      setWorking(false);
    }
  };

  const connectAccount = async () => {
    if (!verification) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/organiser/payout-account', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bankCode,
          accountNumber,
          confirmedAccountName: verification.accountName,
        }),
      });
      const result = (await response.json()) as {
        payout?: Payout;
        error?: string;
      };
      if (!response.ok || !result.payout) {
        throw new Error(result.error || 'The payout account could not be connected.');
      }
      setPayout(result.payout);
      setAccountNumber('');
      setVerification(null);
      setNotice('Direct Paystack settlement is now active.');
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : 'The payout account could not be connected.',
      );
    } finally {
      setWorking(false);
    }
  };

  const disconnectAccount = async () => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const token = await accessToken();
      const response = await fetch('/api/organiser/payout-account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = (await response.json()) as {
        disconnected?: boolean;
        error?: string;
      };
      if (!response.ok || !result.disconnected) {
        throw new Error(
          result.error || 'The payout account could not be disconnected.',
        );
      }
      setPayout(null);
      setBankCode('');
      setAccountNumber('');
      setVerification(null);
      setConfirmDisconnect(false);
      setNotice('The payout account has been disconnected.');
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : 'The payout account could not be disconnected.',
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mt-6 border border-[#241b3f]/10 bg-white p-6 sm:p-8">
      <Landmark className="h-5 w-5 text-emerald-600" />
      <h2 className="mt-4 text-xl font-black">Direct ticket settlement</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        Connect a Nigerian bank account through Paystack. For split payments,
        your ticket subtotal is assigned to your Paystack subaccount while the
        displayed service fee is assigned to Naija Tickets.
      </p>

      {payout && (
        <div
          className={`mt-5 flex gap-3 border p-4 text-sm ${
            payout.enabled
              ? 'border-emerald-500/25 bg-emerald-50 text-emerald-900'
              : 'border-amber-500/30 bg-amber-50 text-amber-950'
          }`}
        >
          {payout.enabled ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-black">
              {payout.enabled
                ? 'Direct settlement active'
                : 'Direct settlement stopped'}
            </p>
            <p className="mt-1">
              {payout.accountName} · {payout.bankName} · account ending in{' '}
              {payout.accountLast4}
            </p>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              disabled={working}
              className="mt-3 inline-flex min-h-11 items-center gap-2 font-bold text-red-700 hover:text-red-600 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Disconnect bank account
            </button>
          </div>
        </div>
      )}

      {payout && confirmDisconnect && (
        <div
          role="alertdialog"
          aria-labelledby="disconnect-payout-title"
          aria-describedby="disconnect-payout-description"
          className="mt-4 border border-red-500/25 bg-red-50 p-5"
        >
          <h3 id="disconnect-payout-title" className="font-black text-red-900">
            Disconnect this bank account?
          </h3>
          <p
            id="disconnect-payout-description"
            className="mt-2 max-w-2xl text-sm leading-6 text-red-800"
          >
            Future ticket payments will stop settling directly to this account.
            Historical payments remain available for accounting and refunds.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setConfirmDisconnect(false)}
              className="h-11 border-red-200 bg-white"
            >
              Keep account
            </Button>
            <Button
              type="button"
              disabled={working}
              onClick={disconnectAccount}
              className="h-11 bg-red-700 px-5 font-black text-white hover:bg-red-600"
            >
              {working ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {working ? 'Disconnecting…' : 'Yes, disconnect'}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={verifyAccount} className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="payout-bank" className="auth-label">
            Bank
          </label>
          <select
            id="payout-bank"
            required
            value={bankCode}
            disabled={loading || working}
            onChange={(event) => {
              setBankCode(event.target.value);
              resetVerification();
            }}
            className="auth-input w-full"
          >
            <option value="">Choose a bank</option>
            {banks.map((bank) => (
              <option key={bank.code} value={bank.code}>
                {bank.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="payout-account-number" className="auth-label">
            Account number
          </label>
          <Input
            id="payout-account-number"
            required
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{10}"
            minLength={10}
            maxLength={10}
            value={accountNumber}
            disabled={loading || working}
            onChange={(event) => {
              setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 10));
              resetVerification();
            }}
            placeholder="10-digit account number"
            className="auth-input"
          />
        </div>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            disabled={loading || working || banks.length === 0}
            className="h-11 bg-[#241b3f] px-5 font-black text-white hover:bg-[#342755]"
          >
            {working ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Verify account
          </Button>
        </div>
      </form>

      {verification && (
        <div className="mt-5 border border-[#241b3f]/10 bg-[#fffaf0] p-4">
          <p className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">
            Paystack verified
          </p>
          <p className="mt-2 font-black">{verification.accountName}</p>
          <p className="mt-1 text-sm text-slate-600">
            {verification.bankName} · account ending in{' '}
            {verification.accountLast4}
          </p>
          <Button
            type="button"
            onClick={connectAccount}
            disabled={working}
            className="mt-4 h-11 bg-emerald-500 px-5 font-black text-emerald-950 hover:bg-emerald-400"
          >
            {working ? 'Connecting…' : 'Connect for direct settlement'}
          </Button>
        </div>
      )}

      <p className="mt-5 max-w-2xl text-xs leading-5 text-slate-500">
        Your complete account number is sent to Paystack only when you verify or
        connect the account. Naija Tickets stores only the bank, verified name,
        last four digits and Paystack subaccount code.
      </p>
      {notice && (
        <output className="mt-4 block border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </output>
      )}
      {error && (
        <output className="mt-4 block border border-red-500/25 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </output>
      )}
    </section>
  );
}
