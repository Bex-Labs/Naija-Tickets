'use client';

import { KeyRound, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AdminAccount = {
  id: string;
  username: string;
  createdAt: string;
  isPrimary: boolean;
  isCurrent: boolean;
};

type AccountsResponse = {
  accounts?: AdminAccount[];
  maximum?: number;
  error?: string;
};

export function AdminAccounts() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [maximum, setMaximum] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const applyResponse = (result: AccountsResponse) => {
    setAccounts(result.accounts || []);
    setMaximum(result.maximum || 3);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/admin/accounts');
        const result = (await response.json()) as AccountsResponse;
        if (!response.ok) {
          throw new Error(
            result.error || 'Administrators could not be loaded.',
          );
        }
        applyResponse(result);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Administrators could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const addAccount = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.get('username'),
          password: values.get('password'),
          confirmPassword: values.get('confirmPassword'),
          currentPassword: values.get('currentPassword'),
        }),
      });
      const result = (await response.json()) as AccountsResponse;
      if (!response.ok) {
        throw new Error(result.error || 'Administrator could not be added.');
      }
      applyResponse(result);
      form.reset();
      setShowAdd(false);
      setNotice('Administrator added. Their login works immediately.');
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Administrator could not be added.',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (accountId: string) => {
    if (!deletePassword) {
      setError('Enter your current password to confirm deletion.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, currentPassword: deletePassword }),
      });
      const result = (await response.json()) as AccountsResponse;
      if (!response.ok) {
        throw new Error(result.error || 'Administrator could not be deleted.');
      }
      applyResponse(result);
      setDeletingId('');
      setDeletePassword('');
      setNotice('Administrator access removed.');
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Administrator could not be deleted.',
      );
    } finally {
      setSaving(false);
    }
  };

  const maximumReached = accounts.length >= maximum;
  return (
    <div className="animate-rise max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration team</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">Admins</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            The primary admin can be joined by two additional administrators.
            Every admin receives the same protected portal access.
          </p>
        </div>
        <Button
          type="button"
          disabled={maximumReached}
          onClick={() => setShowAdd((current) => !current)}
          className="h-11 bg-emerald-500 px-5 font-black text-emerald-950 hover:bg-emerald-400"
        >
          {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {maximumReached
            ? 'Admin limit reached'
            : showAdd
              ? 'Close form'
              : 'Add admin'}
        </Button>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <div className="border border-[#241b3f]/10 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Active admins
          </p>
          <p className="mt-3 text-3xl font-black">{accounts.length}</p>
        </div>
        <div className="border border-[#241b3f]/10 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Available spaces
          </p>
          <p className="mt-3 text-3xl font-black">
            {Math.max(0, maximum - accounts.length)}
          </p>
        </div>
        <div className="border border-[#241b3f]/10 bg-[#241b3f] p-5 text-white">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <p className="mt-3 text-sm font-bold">
            Maximum {maximum} administrators
          </p>
        </div>
      </div>

      {showAdd && !maximumReached && (
        <form
          onSubmit={addAccount}
          className="mt-7 grid gap-5 border border-[#241b3f]/10 bg-white p-6 sm:grid-cols-2"
        >
          <h2 className="text-xl font-black sm:col-span-2">
            New administrator
          </h2>
          <div className="sm:col-span-2">
            <label className="auth-label" htmlFor="new-admin-login-id">
              Private login ID
            </label>
            <Input
              id="new-admin-login-id"
              name="username"
              required
              minLength={3}
              maxLength={80}
              pattern="[A-Za-z0-9._-]+"
              autoComplete="off"
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="new-admin-account-password">
              Password
            </label>
            <Input
              id="new-admin-account-password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="auth-input"
            />
          </div>
          <div>
            <label className="auth-label" htmlFor="new-admin-account-confirm">
              Confirm password
            </label>
            <Input
              id="new-admin-account-confirm"
              name="confirmPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="auth-input"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="auth-label"
              htmlFor="admin-authorisation-password"
            >
              Your current password
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                id="admin-authorisation-password"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="auth-input pl-11"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="h-11 bg-[#241b3f] px-5 font-black text-white hover:bg-[#342755] sm:w-fit"
          >
            {saving ? 'Adding administrator...' : 'Add administrator'}
          </Button>
        </form>
      )}

      {notice && (
        <output className="mt-6 block border border-emerald-500/25 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </output>
      )}
      {error && (
        <output className="mt-6 block border border-red-500/25 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </output>
      )}

      <div className="mt-7 overflow-x-auto border border-[#241b3f]/10 bg-white">
        <table className="w-full min-w-[38rem] text-left text-sm">
          <thead className="border-b border-[#241b3f]/10 bg-[#fff3d8] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="p-4">Administrator</th>
              <th className="p-4">Added</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#241b3f]/10">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500">
                  Loading administrators...
                </td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr key={account.id}>
                  <td className="p-4 font-bold">{account.username}</td>
                  <td className="p-4 text-slate-500">
                    {new Date(account.createdAt).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="p-4">
                    <span className="bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                      {account.isCurrent
                        ? 'Current session'
                        : account.isPrimary
                          ? 'Primary'
                          : 'Active'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {account.isPrimary || account.isCurrent ? (
                      <span className="text-xs text-slate-400">Protected</span>
                    ) : deletingId === account.id ? (
                      <div className="ml-auto flex max-w-xs items-center gap-2">
                        <Input
                          type="password"
                          value={deletePassword}
                          onChange={(event) =>
                            setDeletePassword(event.target.value)
                          }
                          placeholder="Your password"
                          aria-label="Current admin password"
                          className="h-9"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void deleteAccount(account.id)}
                          className="h-9 bg-red-600 px-3 text-xs font-bold text-white"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeletingId('');
                            setDeletePassword('');
                          }}
                          className="h-9 border border-[#241b3f]/15 px-3 text-xs font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingId(account.id);
                          setError('');
                          setNotice('');
                        }}
                        className="inline-flex items-center gap-2 text-xs font-bold text-red-600 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
