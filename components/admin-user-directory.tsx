'use client';

import { Building2, Plus, Trash2, UserRound, X } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  confirmed: boolean;
};

type Organiser = {
  id: string;
  organiserId: string;
  name: string;
  organisation: string;
  email: string;
  phone: string;
  createdAt: string;
};

type DirectoryResponse = {
  customers?: Customer[];
  organisers?: Organiser[];
  error?: string;
};

export function AdminUserDirectory({
  accountKind,
}: {
  accountKind: 'customer' | 'organiser';
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [organisers, setOrganisers] = useState<Organiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const isOrganiser = accountKind === 'organiser';

  const applyResponse = (result: DirectoryResponse) => {
    setCustomers(result.customers || []);
    setOrganisers(result.organisers || []);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/admin/users');
        const result = (await response.json()) as DirectoryResponse;
        if (!response.ok)
          throw new Error(result.error || 'Accounts could not be loaded.');
        applyResponse(result);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Accounts could not be loaded.',
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
    setSaving(true);
    setError('');
    setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountKind,
          name: values.get('name'),
          organisation: values.get('organisation'),
          email: values.get('email'),
          phone: values.get('phone'),
          password: values.get('password'),
        }),
      });
      const result = (await response.json()) as DirectoryResponse;
      if (!response.ok)
        throw new Error(result.error || 'Account could not be created.');
      applyResponse(result);
      form.reset();
      setShowAdd(false);
      setNotice(`${isOrganiser ? 'Organiser' : 'Customer'} account created.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Account could not be created.',
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (userId: string) => {
    if (!deletePassword) {
      setError('Enter your current admin password to confirm deletion.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          accountKind,
          currentPassword: deletePassword,
        }),
      });
      const result = (await response.json()) as DirectoryResponse;
      if (!response.ok)
        throw new Error(result.error || 'Account could not be deleted.');
      applyResponse(result);
      setDeletingId('');
      setDeletePassword('');
      setNotice(`${isOrganiser ? 'Organiser' : 'Customer'} account deleted.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Account could not be deleted.',
      );
    } finally {
      setSaving(false);
    }
  };

  const accounts = isOrganiser ? organisers : customers;
  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Account management</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
            {isOrganiser ? 'Organisers' : 'Customers'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isOrganiser
              ? 'View, add, or remove organiser access from one place.'
              : 'View, add, or remove customer accounts from one place.'}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setShowAdd((current) => !current)}
          className="h-11 bg-emerald-500 px-5 font-black text-emerald-950 hover:bg-emerald-400"
        >
          {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAdd
            ? 'Close form'
            : `Add ${isOrganiser ? 'organiser' : 'customer'}`}
        </Button>
      </div>

      {showAdd && (
        <form
          onSubmit={addAccount}
          className="mt-7 grid gap-5 border border-[#241b3f]/10 bg-white p-6 sm:grid-cols-2"
        >
          <div className="sm:col-span-2 flex items-center gap-3">
            {isOrganiser ? (
              <Building2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <UserRound className="h-5 w-5 text-emerald-600" />
            )}
            <h2 className="text-xl font-black">
              New {isOrganiser ? 'organiser' : 'customer'}
            </h2>
          </div>
          {isOrganiser && (
            <div className="sm:col-span-2">
              <label className="auth-label" htmlFor="directory-organisation">
                Organisation name
              </label>
              <Input
                id="directory-organisation"
                name="organisation"
                required
                minLength={2}
                className="auth-input"
              />
            </div>
          )}
          <div>
            <label
              className="auth-label"
              htmlFor={`directory-${accountKind}-name`}
            >
              Full name
            </label>
            <Input
              id={`directory-${accountKind}-name`}
              name="name"
              required
              minLength={2}
              className="auth-input"
            />
          </div>
          <div>
            <label
              className="auth-label"
              htmlFor={`directory-${accountKind}-phone`}
            >
              Phone
            </label>
            <Input
              id={`directory-${accountKind}-phone`}
              name="phone"
              type="tel"
              required
              minLength={7}
              className="auth-input"
            />
          </div>
          <div>
            <label
              className="auth-label"
              htmlFor={`directory-${accountKind}-email`}
            >
              Email address
            </label>
            <Input
              id={`directory-${accountKind}-email`}
              name="email"
              type="email"
              required
              className="auth-input"
            />
          </div>
          <div>
            <label
              className="auth-label"
              htmlFor={`directory-${accountKind}-password`}
            >
              Temporary password
            </label>
            <Input
              id={`directory-${accountKind}-password`}
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="auth-input"
            />
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="h-11 bg-[#241b3f] px-5 font-black text-white hover:bg-[#342755] sm:col-span-2 sm:w-fit"
          >
            {saving ? 'Creating account...' : 'Create account'}
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
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-b border-[#241b3f]/10 bg-[#fff3d8] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="p-4">{isOrganiser ? 'Organiser' : 'Customer'}</th>
              {isOrganiser && <th className="p-4">Organisation</th>}
              <th className="p-4">Contact</th>
              <th className="p-4">Joined</th>
              <th className="p-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#241b3f]/10">
            {loading ? (
              <tr>
                <td
                  colSpan={isOrganiser ? 5 : 4}
                  className="p-8 text-center text-slate-500"
                >
                  Loading accounts...
                </td>
              </tr>
            ) : accounts.length ? (
              accounts.map((account) => (
                <tr key={account.id}>
                  <td className="p-4 font-bold">{account.name}</td>
                  {isOrganiser && (
                    <td className="p-4">
                      {(account as Organiser).organisation}
                    </td>
                  )}
                  <td className="p-4 text-slate-600">
                    <span className="block">{account.email}</span>
                    <span className="mt-1 block text-xs">
                      {account.phone || 'No phone'}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500">
                    {new Date(account.createdAt).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="p-4 text-right">
                    {deletingId === account.id ? (
                      <div className="ml-auto flex max-w-xs items-center gap-2">
                        <Input
                          type="password"
                          value={deletePassword}
                          onChange={(event) =>
                            setDeletePassword(event.target.value)
                          }
                          placeholder="Admin password"
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
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={isOrganiser ? 5 : 4}
                  className="p-10 text-center text-slate-500"
                >
                  No {isOrganiser ? 'organisers' : 'customers'} found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Deleted accounts lose sign-in access. Existing booking and event records
        are retained for operational history.
      </p>
    </div>
  );
}
