'use client';
import { OrganiserHostedCheckout } from '@/components/organiser-hosted-checkout';
import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  Code2,
  Copy,
  KeyRound,
  Plus,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { accountFetch } from '@/lib/supabase/account-fetch';
import { INTEGRATION_SCOPES } from '@/lib/integrations/types';
import type {
  IntegrationScope,
  IntegrationApplication,
  IntegrationDashboard,
  IntegrationEnvironment,
} from '@/lib/integrations/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { OrganiserWebhooks } from '@/components/organiser-webhooks';
import { OrganiserWidget } from '@/components/organiser-widget';

type Result<T> = { data?: T; error?: { message?: string } };
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
export function OrganiserIntegrations() {
  const [dashboard, setDashboard] = useState<IntegrationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [organiserId, setOrganiserId] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'disabled'>('active');
  const [testOrigins, setTestOrigins] = useState('');
  const [liveOrigins, setLiveOrigins] = useState('');
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [environment, setEnvironment] =
    useState<IntegrationEnvironment>('test');
  const [readScopes, setReadScopes] = useState<IntegrationScope[]>([
    'integration:read',
  ]);
  const [expiryDays, setExpiryDays] = useState(90);
  const [secret, setSecret] = useState('');
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    id: string;
    name: string;
    action: 'enable' | 'disable' | 'remove';
  } | null>(null);
  const selected = dashboard?.integrations.find((app) => app.id === selectedId);
  const originsText = (text: string) =>
    text
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .sort()
      .join('\n');
  const unsavedChanges =
    !!selected &&
    (selected.name !== name ||
      selected.status !== status ||
      selected.organiserId !== organiserId ||
      [...selected.eventIds].sort().join(',') !==
        [...eventIds].sort().join(',') ||
      originsText(testOrigins) !==
        originsText(
          selected.domains
            .filter((d) => d.environment === 'test')
            .map((d) => d.origin)
            .join('\n'),
        ) ||
      originsText(liveOrigins) !==
        originsText(
          selected.domains
            .filter((d) => d.environment === 'live')
            .map((d) => d.origin)
            .join('\n'),
        ));
  const selectApp = (
    app?: IntegrationApplication,
    fallbackOrganiser?: string,
  ) => {
    setLifecycleTarget(null);
    setSelectedId(app?.id || '');
    setOrganiserId(
      app?.organiserId ||
        fallbackOrganiser ||
        dashboard?.organisers[0]?.id ||
        '',
    );
    setName(app?.name || '');
    setStatus(app?.status || 'active');
    setTestOrigins(
      app?.domains
        .filter((domain) => domain.environment === 'test')
        .map((domain) => domain.origin)
        .join('\n') || '',
    );
    setLiveOrigins(
      app?.domains
        .filter((domain) => domain.environment === 'live')
        .map((domain) => domain.origin)
        .join('\n') || '',
    );
    setEventIds(app?.eventIds || []);
    setSecret('');
    setError('');
    setNotice('');
  };
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await accountFetch('/api/organiser/integrations', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = (await response.json()) as Result<IntegrationDashboard>;
        if (!response.ok || !result.data)
          throw new Error(
            result.error?.message || 'Integrations could not be loaded.',
          );
        if (!controller.signal.aborted) {
          setDashboard(result.data);
          const available = result.data.organisers;
          setOrganiserId((current) =>
            available.some((org) => org.id === current)
              ? current
              : available[0]?.id || '',
          );
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Integrations could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);
  async function mutate<T>(url: string, method: string, body?: unknown) {
    const response = await accountFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json()) as Result<T>;
    if (!response.ok || !result.data)
      throw new Error(
        result.error?.message || 'The integration could not be updated.',
      );
    return result.data;
  }
  function replaceApp(app: IntegrationApplication) {
    setDashboard((current) =>
      current
        ? {
            ...current,
            integrations: [
              app,
              ...current.integrations.filter((item) => item.id !== app.id),
            ],
          }
        : current,
    );
    setSelectedId(app.id);
  }
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setSecret('');
    const origins = (text: string, mode: IntegrationEnvironment) =>
      text
        .split(/\r?\n/)
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => ({ origin, environment: mode }));
    try {
      const app = await mutate<IntegrationApplication>(
        selectedId
          ? `/api/organiser/integrations/${selectedId}`
          : '/api/organiser/integrations',
        selectedId ? 'PATCH' : 'POST',
        {
          organiserId,
          name,
          status,
          domains: [
            ...origins(testOrigins, 'test'),
            ...origins(liveOrigins, 'live'),
          ],
          eventIds,
        },
      );
      replaceApp(app);
      selectApp(app);
      setNotice(
        selectedId
          ? 'Integration updated.'
          : 'Website connection saved. Create a checkout link below; no API key is needed.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to save this integration.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeLifecycle() {
    if (!lifecycleTarget || busy) return;
    const target = lifecycleTarget;
    setBusy(true);
    setError('');
    setNotice('');
    setSecret('');
    try {
      if (target.action === 'remove') {
        await mutate<{ id: string; removed: true }>(
          `/api/organiser/integrations/${target.id}`,
          'DELETE',
        );
        setDashboard((current) =>
          current
            ? {
                ...current,
                integrations: current.integrations.filter(
                  (app) => app.id !== target.id,
                ),
              }
            : current,
        );
        selectApp();
        setNotice(
          'Integration removed. Existing orders, tickets and sales history are preserved.',
        );
      } else {
        const app = await mutate<IntegrationApplication>(
          `/api/organiser/integrations/${target.id}/status`,
          'POST',
          { status: target.action === 'enable' ? 'active' : 'disabled' },
        );
        replaceApp(app);
        selectApp(app);
        setNotice(
          target.action === 'enable'
            ? 'Integration enabled. Your saved connection settings are active again.'
            : 'Integration disabled. New API requests, checkouts and outgoing notifications are paused. You can enable it again.',
        );
      }
      setLifecycleTarget(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update this integration.',
      );
      setLifecycleTarget(null);
    } finally {
      setBusy(false);
    }
  }
  async function keyAction(
    action: 'create' | 'rotate' | 'revoke',
    keyId?: string,
  ) {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setSecret('');
    try {
      const base = `/api/organiser/integrations/${selectedId}/keys`;
      if (action === 'revoke') {
        const app = await mutate<IntegrationApplication>(
          `${base}/${keyId}/revoke`,
          'POST',
        );
        replaceApp(app);
        setNotice('API key revoked. It can no longer be used.');
      } else {
        const result = await mutate<{
          application: IntegrationApplication;
          secret: string;
        }>(
          action === 'rotate' ? `${base}/${keyId}/rotate` : base,
          'POST',
          action === 'create'
            ? {
                environment,
                scopes: readScopes,
                expiresInDays: expiryDays,
              }
            : undefined,
        );
        replaceApp(result.application);
        setSecret(result.secret);
        setNotice(
          action === 'rotate'
            ? 'New key created and the previous key revoked. Copy the new secret now.'
            : 'Copy this secret now. It will not be shown again.',
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to update API keys.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setNotice('Secret copied. Keep it on your server.');
    } catch {
      setError(
        'Copy is unavailable in this browser. Select and copy the secret below.',
      );
    }
  }
  if (loading)
    return (
      <output className="block py-8 text-sm text-slate-600">
        Loading integrations…
      </output>
    );
  return (
    <div className="animate-rise max-w-5xl min-w-0">
      <AlertDialog
        open={Boolean(lifecycleTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setLifecycleTarget(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto bg-white text-[#241b3f] shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lifecycleTarget?.action === 'remove'
                ? 'Remove integration?'
                : lifecycleTarget?.action === 'enable'
                  ? 'Enable integration?'
                  : 'Disable integration?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {lifecycleTarget?.action === 'remove'
                ? `Remove “${lifecycleTarget.name}” from your list and revoke its API keys. Its checkout links, widgets and outgoing notifications will stop. This cannot be enabled again; create a new integration to reconnect.`
                : lifecycleTarget?.action === 'enable'
                  ? `Enable “${lifecycleTarget.name}” with its saved keys and settings.`
                  : `Pause “${lifecycleTarget?.name}”. API access, new checkouts and outgoing notifications will stop until you enable it again.`}
            </AlertDialogDescription>
            <p className="mt-2 text-sm text-slate-600">
              Existing orders, issued tickets and sales history are preserved. A
              payment already in progress can still complete safely.
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void changeLifecycle()}
              className={
                lifecycleTarget?.action === 'remove'
                  ? 'bg-red-700 text-white hover:bg-red-800'
                  : 'bg-[#241b3f] text-white'
              }
            >
              {busy
                ? 'Saving…'
                : lifecycleTarget?.action === 'remove'
                  ? 'Remove integration'
                  : lifecycleTarget?.action === 'enable'
                    ? 'Enable integration'
                    : 'Disable integration'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="eyebrow">Developer tools</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">
          Developers &amp; Integrations
        </h1>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setSecret('');
            setError('');
            setLoading(true);
            setReload((current) => current + 1);
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Sell tickets from your own website with a Hosted Checkout Link — no
        programming or API key needed. Developers can also connect a backend
        using the Hosted Checkout API.
      </p>
      <section className="mt-4 rounded-xl border border-emerald-200 bg-white p-4 sm:p-5">
        <h2 className="font-black">Sell tickets without coding</h2>
        <ol className="mt-3 grid list-inside list-decimal gap-3 text-sm leading-6 text-slate-600 sm:grid-cols-3">
          <li>
            Name your website connection, add its website address and select
            your events.
          </li>
          <li>Save it, then create a checkout link for an event below.</li>
          <li>Copy the link into your website builder’s Buy Tickets button.</li>
        </ol>
        <a
          href="/developers/no-code"
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
        >
          Follow the no-code setup guide →
        </a>
      </section>
      <div className="mt-4 flex items-start gap-3 border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Live API keys can read assigned, published events, ticket types and
          availability with the permissions you select. Test event reads are
          unavailable until an isolated sandbox is configured. Hosted checkout
          requires separate server configuration. Ticket widgets require an
          explicit application opt-in and a configured deployment.
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-4 break-words text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-4 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      {dashboard && !dashboard.organisers.length && (
        <p className="mt-6 text-sm text-slate-600">
          Only organiser owners and authorised integration managers have access
          to developer tools. Contact platform support if you need access.
          Customer and event-entry accounts cannot create API keys.
        </p>
      )}
      {!!dashboard?.organisers.length && (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="integration-select" className="auth-label">
                Applications
              </label>
              <select
                id="integration-select"
                className="auth-input w-full bg-white"
                value={selectedId}
                disabled={busy}
                onChange={(event) =>
                  selectApp(
                    dashboard.integrations.find(
                      (app) => app.id === event.target.value,
                    ),
                  )
                }
              >
                <option value="">Register a new application</option>
                {dashboard.integrations.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name} · {app.status}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => selectApp()}
            >
              <Plus className="h-4 w-4" />
              New application
            </Button>
          </div>
          <form
            onSubmit={(event) => void save(event)}
            className="mt-5 grid gap-4 border border-[#241b3f]/10 bg-white p-4 sm:grid-cols-2 sm:p-6"
          >
            <div>
              <label htmlFor="integration-organiser" className="auth-label">
                Organiser account
              </label>
              <select
                id="integration-organiser"
                value={organiserId}
                disabled={busy || Boolean(selectedId)}
                onChange={(event) => {
                  setOrganiserId(event.target.value);
                  setEventIds([]);
                }}
                className="auth-input w-full bg-white"
                required
              >
                {dashboard.organisers.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="integration-name" className="auth-label">
                Application name
              </label>
              <Input
                id="integration-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
                disabled={busy}
                className="auth-input"
                placeholder="My event website"
              />
            </div>
            <div>
              <label htmlFor="integration-test-origins" className="auth-label">
                Test website origins
              </label>
              <textarea
                id="integration-test-origins"
                value={testOrigins}
                onChange={(event) => setTestOrigins(event.target.value)}
                disabled={busy}
                rows={3}
                className="auth-input w-full py-3"
                placeholder="http://localhost:3001"
              />
              <p className="mt-1 text-xs text-slate-500">
                One origin per line. Localhost HTTP is allowed for testing.
              </p>
            </div>
            <div>
              <label htmlFor="integration-live-origins" className="auth-label">
                Live website origins
              </label>
              <textarea
                id="integration-live-origins"
                value={liveOrigins}
                onChange={(event) => setLiveOrigins(event.target.value)}
                disabled={busy}
                rows={3}
                className="auth-input w-full py-3"
                placeholder="https://events.example.com"
              />
              <p className="mt-1 text-xs text-slate-500">
                HTTPS only. No paths, wildcards or secret credentials.
              </p>
            </div>
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="auth-label">
                Events this application may access
              </legend>
              <p className="mb-2 text-xs leading-5 text-slate-500">
                Choose which events this website can access through its API
                keys, checkout links and widgets. No selection means no event
                access. Save integration to apply changes; a draft must still be
                published separately.
              </p>
              {selected && (
                <output
                  className={`mb-2 block text-xs font-bold ${unsavedChanges ? 'text-amber-800' : 'text-emerald-800'}`}
                >
                  {unsavedChanges
                    ? 'Unsaved changes. The website still uses the last saved permissions.'
                    : `${selected.eventIds.length} event${selected.eventIds.length === 1 ? '' : 's'} allowed in the saved connection.`}
                </output>
              )}
              <div className="max-h-44 space-y-2 overflow-y-auto border border-[#241b3f]/10 p-3">
                {dashboard.events
                  .filter((event) => event.organiserId === organiserId)
                  .map((event) => (
                    <label
                      key={event.id}
                      className="flex min-h-9 items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={eventIds.includes(event.id)}
                        disabled={busy}
                        onChange={(change) =>
                          setEventIds((current) =>
                            change.target.checked
                              ? [...current, event.id]
                              : current.filter((id) => id !== event.id),
                          )
                        }
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                      />
                      <span className="min-w-0 break-words">
                        {event.title}
                        <span className="ml-2 text-xs text-slate-500">
                          {event.status}
                        </span>
                      </span>
                    </label>
                  ))}
                {!dashboard.events.some(
                  (event) => event.organiserId === organiserId,
                ) && (
                  <p className="text-xs text-slate-500">
                    No events in this organiser account yet.
                  </p>
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Public event pages remain visible on Naija Tickets. Connecting
                an API key alone only verifies the connection; it does not grant
                access to every event.
              </p>
            </fieldset>
            <div>
              <label htmlFor="integration-status" className="auth-label">
                Integration status
              </label>
              <select
                id="integration-status"
                value={status}
                disabled={busy}
                onChange={(event) =>
                  setStatus(event.target.value as 'active' | 'disabled')
                }
                className="auth-input w-full bg-white"
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Disabling pauses API access, new checkouts and outgoing
                notifications. You can enable it again.
              </p>
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {busy
                  ? 'Saving…'
                  : selectedId
                    ? 'Save integration'
                    : 'Register application'}
              </Button>
            </div>
          </form>
          {selected && (
            <section
              className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-[#241b3f]/10 bg-white p-4 sm:p-6"
              aria-labelledby="integration-access-heading"
            >
              <div className="min-w-0 flex-1 basis-56">
                <h2 id="integration-access-heading" className="font-black">
                  Manage integration
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selected.status === 'active'
                    ? 'Active · Your website can connect.'
                    : 'Disabled · New connections are paused.'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Disable to pause it. Remove to disconnect it and revoke its
                  keys. Existing purchases stay available.
                </p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setLifecycleTarget({
                      id: selected.id,
                      name: selected.name,
                      action:
                        selected.status === 'active' ? 'disable' : 'enable',
                    })
                  }
                >
                  {selected.status === 'active' ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {selected.status === 'active'
                    ? 'Disable integration'
                    : 'Enable integration'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="text-red-700 hover:bg-red-50"
                  disabled={busy}
                  onClick={() =>
                    setLifecycleTarget({
                      id: selected.id,
                      name: selected.name,
                      action: 'remove',
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove integration
                </Button>
              </div>
            </section>
          )}
          {selected && (
            <OrganiserHostedCheckout
              key={'hosted-' + selected.id}
              application={selected}
              events={dashboard.events}
              settingsPending={unsavedChanges}
            />
          )}
          <details className="mt-6 rounded-xl border border-[#241b3f]/10 bg-white p-4 sm:p-6">
            <summary className="cursor-pointer font-black">
              Advanced connections · API keys, widgets and webhooks
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              These tools are for developers. A Buy Tickets link above works
              without them.
            </p>
            {selected && (
              <section
                className="mt-6 border border-[#241b3f]/10 bg-white p-4 sm:p-6"
                aria-labelledby="integration-keys-heading"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-emerald-700" />
                  <h2
                    id="integration-keys-heading"
                    className="text-xl font-black"
                  >
                    API credentials
                  </h2>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  For developers only. Skip this section when using a checkout
                  link. Keep secret keys on your server. Never place them in an
                  embed snippet or browser code. Rotation revokes the previous
                  key immediately.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor="integration-key-mode"
                      className="auth-label"
                    >
                      Mode
                    </label>
                    <select
                      id="integration-key-mode"
                      value={environment}
                      onChange={(event) =>
                        setEnvironment(
                          event.target.value as IntegrationEnvironment,
                        )
                      }
                      disabled={busy}
                      className="auth-input w-full bg-white"
                    >
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="integration-key-expiry"
                      className="auth-label"
                    >
                      Expires after
                    </label>
                    <select
                      id="integration-key-expiry"
                      value={expiryDays}
                      onChange={(event) =>
                        setExpiryDays(Number(event.target.value))
                      }
                      disabled={busy}
                      className="auth-input w-full bg-white"
                    >
                      {[30, 90, 365].map((days) => (
                        <option key={days} value={days}>
                          {days} days
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      disabled={
                        busy || unsavedChanges || selected.status !== 'active'
                      }
                      onClick={() => void keyAction('create')}
                      className="w-full bg-[#241b3f] text-white"
                    >
                      <Plus className="h-4 w-4" />
                      Generate key
                    </Button>
                  </div>
                </div>
                <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
                  <legend className="mb-2 text-sm font-semibold">
                    Key permissions
                  </legend>
                  {INTEGRATION_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="flex min-h-10 items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={readScopes.includes(scope)}
                        disabled={busy}
                        onChange={(event) =>
                          setReadScopes((current) =>
                            event.target.checked
                              ? [...current, scope]
                              : current.filter((value) => value !== scope),
                          )
                        }
                        className="h-4 w-4 shrink-0 accent-emerald-600"
                      />
                      <span>
                        {
                          {
                            'integration:read': 'Integration details',
                            'events:read': 'Event information',
                            'tickets:read': 'Ticket types and prices',
                            'availability:read': 'Available ticket quantities',
                            'checkout:write': 'Create hosted checkouts',
                            'orders:read':
                              'Your application’s orders and checkout results',
                            'tickets:status':
                              'Purchased ticket status (no QR codes)',
                            'attendees:read': 'Registered attendee names',
                            'attendees:contact':
                              'Attendee email and phone (also select attendee names)',
                            'sales:read': 'Your application’s sales totals',
                            'groups:read':
                              'Group registration counts (no invite links)',
                            'refunds:read':
                              'Recorded refund status (read only)',
                            'entry:verify':
                              'Verify your application’s tickets as the key creator',
                            'entry:check-in':
                              'Check in tickets as the key creator (also select verification)',
                          }[scope]
                        }
                        <code className="block text-xs text-slate-500">
                          {scope}
                        </code>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Existing keys keep their permissions. Generate a new key to
                  add access; rotating preserves its current permissions.
                </p>
                {secret && (
                  <div className="mt-4 border border-amber-300 bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-950">
                      Your secret key — shown once
                    </p>
                    <code className="mt-2 block select-all break-all text-xs leading-6 text-amber-950">
                      {secret}
                    </code>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void copySecret()}
                      >
                        <Copy className="h-4 w-4" />
                        Copy secret
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSecret('')}
                      >
                        I have saved it
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-5 divide-y divide-[#241b3f]/10">
                  {selected.keys.map((key) => {
                    const expired = Date.parse(key.expiresAt) <= clock;
                    return (
                      <div
                        key={key.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                      >
                        <div className="min-w-0">
                          <p className="break-all font-mono text-xs">
                            {key.display}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {key.environment === 'test' ? 'Test' : 'Live'} ·{' '}
                            {key.revokedAt
                              ? 'Revoked'
                              : expired
                                ? 'Expired'
                                : 'Active'}{' '}
                            · Created {date(key.createdAt)} · Expires{' '}
                            {date(key.expiresAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {key.scopes.length
                              ? key.scopes.join(', ')
                              : 'No permissions'}{' '}
                            ·{' '}
                            {key.lastUsedAt
                              ? `Last used ${date(key.lastUsedAt)}`
                              : 'Not used yet'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {!key.revokedAt && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy || selected.status !== 'active'}
                                onClick={() => void keyAction('rotate', key.id)}
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Rotate
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void keyAction('revoke', key.id)}
                                className="text-red-700"
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {!selected.keys.length && (
                    <p className="py-5 text-sm text-slate-500">
                      No API keys yet.
                    </p>
                  )}
                </div>
                <p className="mt-3 break-all text-xs text-slate-500">
                  Public widget identifier: <code>{selected.widgetId}</code>.
                  Use it in the embed snippet below; it cannot authenticate
                  private API requests.
                </p>
              </section>
            )}
            {selected && (
              <OrganiserWidget
                key={'widget-' + selected.id}
                application={selected}
                events={dashboard.events}
              />
            )}
            {selected && (
              <OrganiserWebhooks
                key={selected.id}
                applicationId={selected.id}
              />
            )}
            <section className="mt-6 border border-[#241b3f]/10 bg-white p-4 sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-black">
                <Code2 className="h-5 w-5 text-emerald-700" />
                Check your connection
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                From your server, send a GET request to{' '}
                <code>/api/v1/integration</code> with{' '}
                <code>Authorization: Bearer YOUR_SECRET_KEY</code>. The response
                confirms the application, mode and granted permissions. This
                endpoint does not return events, customer information or
                tickets.
              </p>
            </section>
          </details>
        </>
      )}
    </div>
  );
}
