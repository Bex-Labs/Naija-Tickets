'use client';
import { IntegrationSalesReport } from './integration-sales-report';
import { useEffect, useState, useRef, type SyntheticEvent } from 'react';
import type {
  AdminIntegrationOverview,
  AdminIntegrationActivity,
  AdminIntegrationRow,
} from '@/lib/integrations/admin-types';
export function AdminIntegrations() {
  const activityRequest = useRef(0);
  const [data, setData] = useState<AdminIntegrationOverview | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [query, setQuery] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<AdminIntegrationRow | null>(null),
    [activity, setActivity] = useState<AdminIntegrationActivity | null>(null),
    [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(''),
    [reason, setReason] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/admin/integrations' + query, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          data?: AdminIntegrationOverview;
          error?: { message?: string };
        };
        if (!response.ok || !result.data)
          throw new Error(
            result.error?.message || 'Applications could not be loaded.',
          );
        if (!controller.signal.aborted) setData(result.data);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Applications unavailable.',
          );
      }
    })();
    return () => controller.abort();
  }, [query, refresh]);
  const date = (value: string) =>
    new Date(value).toLocaleString('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  async function inspect(app: AdminIntegrationRow, before?: string) {
    const request = ++activityRequest.current;
    setSelected(app);
    setActivity(null);
    setError('');
    setReason('');
    setPassword('');
    try {
      const response = await fetch(
        '/api/admin/integrations/' +
          app.id +
          (before ? '?before=' + before : ''),
        { cache: 'no-store' },
      );
      const result = (await response.json()) as {
        data?: AdminIntegrationActivity;
        error?: { message?: string };
      };
      if (!response.ok || !result.data)
        throw new Error(result.error?.message || 'Activity unavailable.');
      if (request === activityRequest.current) setActivity(result.data);
    } catch (cause) {
      if (request === activityRequest.current)
        setError(
          cause instanceof Error ? cause.message : 'Activity unavailable.',
        );
    }
  }
  async function decide(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/integrations/' + selected.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: selected.suspendedAt ? 'restore' : 'suspend',
          reason,
          password,
        }),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(result.error?.message || 'Review could not be saved.');
      setNotice(
        selected.suspendedAt
          ? 'Review saved. The owner must enable the application and create fresh keys.'
          : 'Application suspended. Keys revoked; widgets and outgoing endpoints paused.',
      );
      setSelected(null);
      setActivity(null);
      setData(null);
      setRefresh((v) => v + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }
  function filter(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setData(null);
    setError('');
    setSelected(null);
    setActivity(null);
    setQuery('?' + new URLSearchParams({ search, status }));
  }
  return (
    <div className="min-w-0 animate-rise">
      <p className="eyebrow">Developer platform</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
        Integrations
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        Review registered applications, API activity and delivery failures.
        Credentials and customer details are excluded.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-4 block border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {notice}
        </output>
      )}
      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[
              ['Applications', data.totals.applications],
              ['Suspended', data.totals.suspended],
              ['Requests · 24h', data.totals.requests24h],
              ['Errors · 24h', data.totals.errors24h],
              ['Exhausted deliveries', data.totals.exhaustedDeliveries],
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 border border-[#241b3f]/10 bg-white p-3"
              >
                <p className="text-xs text-slate-600">{label}</p>
                <p className="mt-1 text-2xl font-black">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {data.resourceMode === 'test'
              ? 'Isolated test database'
              : 'Live database'}{' '}
            · Updated {date(data.asOf)}. Counts cover authenticated API
            requests; rejected unknown keys and public widget requests remain in
            safe server logs.
          </p>
        </>
      )}
      <form onSubmit={filter} className="mt-5 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor="integration-search" className="auth-label">
            Application or organiser
          </label>
          <input
            id="integration-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={80}
            className="auth-input w-full"
          />
        </div>
        <div>
          <label htmlFor="integration-status" className="auth-label">
            Status
          </label>
          <select
            id="integration-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="auth-input bg-white"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button
          className="min-h-11 bg-emerald-600 px-4 font-bold text-white"
          type="submit"
        >
          Apply filters
        </button>
        <button
          className="min-h-11 border px-4 text-sm font-bold"
          type="button"
          onClick={() => {
            setError('');
            setRefresh((v) => v + 1);
          }}
        >
          Refresh
        </button>
      </form>
      {!data && !error && (
        <p className="mt-5 text-sm text-slate-600">Loading applications…</p>
      )}
      <div className="mt-4 divide-y divide-[#241b3f]/10 border border-[#241b3f]/10 bg-white">
        {data?.applications.map((app) => (
          <article key={app.id} className="min-w-0 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 basis-48">
                <h2 className="break-words font-black">{app.name}</h2>
                <p className="break-words text-xs text-slate-600">
                  {app.organiserName} · {app.activeKeys} active keys ·{' '}
                  {app.assignedEvents} events
                </p>
              </div>
              <span
                className={
                  'px-2 py-1 text-xs font-bold ' +
                  (app.suspendedAt
                    ? 'bg-red-100 text-red-900'
                    : app.status === 'active'
                      ? 'bg-emerald-600 text-black'
                      : 'bg-slate-100 text-slate-800')
                }
              >
                {app.suspendedAt ? 'Suspended' : app.status}
              </span>
              <p className="text-xs text-slate-600">
                {app.requests24h} requests · {app.errors24h} errors
              </p>
              <button
                type="button"
                className="min-h-11 border px-3 text-xs font-bold"
                onClick={() => void inspect(app)}
              >
                Review activity
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {app.pendingDeliveries} deliveries waiting ·{' '}
              {app.exhaustedDeliveries} exhausted
              {app.suspensionReason ? ' · ' + app.suspensionReason : ''}
            </p>
          </article>
        ))}
        {data && !data.applications.length && (
          <p className="p-4 text-sm text-slate-600">
            No applications match these filters.
          </p>
        )}
      </div>
      {data?.nextCursor && (
        <button
          type="button"
          className="mt-3 min-h-11 border px-4 text-sm font-bold"
          onClick={() => {
            setData(null);
            setQuery(
              '?' +
                new URLSearchParams({
                  search,
                  status,
                  after: data.nextCursor!,
                }),
            );
          }}
        >
          Next applications
        </button>
      )}
      {selected && (
        <section className="mt-5 min-w-0 border border-[#241b3f]/10 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-black">
                {selected.name}
              </h2>
              <p className="mt-1 break-all font-mono text-xs text-slate-500">
                {selected.id}
              </p>
            </div>
            <button
              type="button"
              className="min-h-11 px-3 text-sm font-bold"
              onClick={() => {
                activityRequest.current++;
                setSelected(null);
                setActivity(null);
                setPassword('');
              }}
            >
              Close
            </button>
          </div>
          {activity?.hosted && (
            <IntegrationSalesReport report={activity.hosted} />
          )}
          <h3 className="mt-4 font-bold">Recent API activity</h3>
          <div className="mt-2 divide-y border-y">
            {activity?.requests.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 basis-40 break-words font-mono">
                  {r.route}
                </span>
                <span
                  className={
                    r.status >= 400
                      ? 'font-bold text-red-800'
                      : 'font-bold text-emerald-800'
                  }
                >
                  {r.status}
                </span>
                <span>{r.durationMs} ms</span>
                <span className="text-slate-500">{date(r.createdAt)}</span>
                {r.errorCode && (
                  <span className="basis-full break-all text-red-800">
                    {r.errorCode}
                  </span>
                )}
              </div>
            ))}
          </div>
          {activity && !activity.requests.length && (
            <p className="mt-2 text-xs text-slate-500">
              No retained authenticated requests.
            </p>
          )}
          {activity?.nextCursor && (
            <button
              type="button"
              className="min-h-11 text-sm font-bold text-emerald-800"
              onClick={() => void inspect(selected, activity.nextCursor!)}
            >
              Older requests
            </button>
          )}
          <h3 className="mt-4 font-bold">Latest security audit</h3>
          {activity?.audit.map((a) => (
            <div key={a.id} className="border-b py-2 text-xs">
              <p className="break-all font-mono">{a.action}</p>
              <p className="mt-1 break-all text-slate-500">
                {date(a.createdAt)}
                {a.outcome ? ' · ' + a.outcome : ''}
                {a.adminActorId ? ' · Admin ' + a.adminActorId : ''}
              </p>
            </div>
          ))}
          <form
            onSubmit={(event) => void decide(event)}
            className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <h3 className="font-bold">
                {selected.suspendedAt
                  ? 'Restore configuration access'
                  : 'Suspend this application'}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Suspension revokes keys and pauses widgets and outgoing
                endpoints. Confirmed payments can still finish safely. Restoring
                access leaves the application disabled and requires fresh
                credentials and explicit owner setup.
              </p>
            </div>
            <div>
              <label htmlFor="integration-reason" className="auth-label">
                Review reason
              </label>
              <input
                id="integration-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="auth-input w-full"
                minLength={5}
                maxLength={240}
                required
              />
            </div>
            <div>
              <label htmlFor="integration-password" className="auth-label">
                Your current admin password
              </label>
              <input
                id="integration-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input w-full"
                maxLength={1024}
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 bg-[#241b3f] px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2"
            >
              {busy
                ? 'Saving review…'
                : selected.suspendedAt
                  ? 'Restore configuration access'
                  : 'Suspend application'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
