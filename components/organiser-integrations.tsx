'use client';
import { OrganiserHostedCheckout } from '@/components/organiser-hosted-checkout';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
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
import { canonicalIntegrationOrigin } from '@/lib/integrations/validation';
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
const RECOMMENDED_CHECKOUT_SCOPES: IntegrationScope[] = [
  'integration:read',
  'events:read',
  'tickets:read',
  'availability:read',
  'checkout:write',
  'orders:read',
];
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
  const initialModeSet = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [organiserId, setOrganiserId] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'disabled'>('active');
  const [testOrigins, setTestOrigins] = useState('');
  const [liveOrigins, setLiveOrigins] = useState('');
  const [connectionEnvironment, setConnectionEnvironment] =
    useState<IntegrationEnvironment>('live');
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [environment, setEnvironment] =
    useState<IntegrationEnvironment>('live');
  const [readScopes, setReadScopes] = useState<IntegrationScope[]>(
    RECOMMENDED_CHECKOUT_SCOPES,
  );
  const [expiryDays, setExpiryDays] = useState(90);
  const [secret, setSecret] = useState('');
  const [setupPath, setSetupPath] = useState<'link' | 'api'>('link');
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    id: string;
    name: string;
    action: 'enable' | 'disable' | 'remove';
  } | null>(null);
  const selected = dashboard?.integrations.find((app) => app.id === selectedId);
  const eventWebsite = dashboard?.events.find(
    (event) => eventIds.includes(event.id) && event.websiteUrl,
  )?.websiteUrl;
  const defaultEnvironment =
    dashboard?.workspaceMode === 'test' ? 'test' : 'live';
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
    if (!app) {
      setConnectionEnvironment(defaultEnvironment);
      setEnvironment(defaultEnvironment);
    } else {
      const modes = new Set(app.domains.map((domain) => domain.environment));
      const mode =
        modes.size === 1 ? app.domains[0].environment : connectionEnvironment;
      setConnectionEnvironment(mode);
      setEnvironment(mode);
    }
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
          if (!initialModeSet.current) {
            const mode = result.data.workspaceMode === 'test' ? 'test' : 'live';
            setEnvironment(mode);
            setConnectionEnvironment(mode);
            initialModeSet.current = true;
          }
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
        .map((origin) => ({
          origin: canonicalIntegrationOrigin(origin, mode),
          environment: mode,
        }));
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
    <div className="integration-fields animate-rise max-w-5xl min-w-0">
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
      <section
        className="mt-5 grid gap-3 sm:grid-cols-2"
        aria-label="Choose how to connect"
      >
        <button
          type="button"
          aria-pressed={setupPath === 'link'}
          onClick={() => setSetupPath('link')}
          className={`rounded-xl border p-4 text-left transition-colors ${setupPath === 'link' ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-[#241b3f]/15 bg-white hover:border-emerald-400'}`}
        >
          <p className="text-sm font-black text-emerald-800">
            RECOMMENDED · NO CODE
          </p>
          <h2 className="mt-1 text-lg font-black">Buy Tickets button</h2>
          <p className="mt-2 text-sm leading-5 text-slate-600">Copy a checkout link.</p>
        </button>
        <button
          type="button"
          aria-pressed={setupPath === 'api'}
          onClick={() => setSetupPath('api')}
          className={`rounded-xl border p-4 text-left transition-colors ${setupPath === 'api' ? 'border-[#241b3f] bg-[#241b3f]/5 ring-1 ring-[#241b3f]' : 'border-[#241b3f]/15 bg-white hover:border-[#241b3f]/40'}`}
        >
          <p className="text-sm font-black text-[#241b3f]">FOR DEVELOPERS</p>
          <h2 className="mt-1 text-lg font-black">Connect with the API</h2>
          <p className="mt-2 text-sm leading-5 text-slate-600">Connect your server.</p>
        </button>
      </section>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        {dashboard?.workspaceMode === 'test'
          ? 'Test workspace · No real charges.'
          : dashboard?.workspaceMode === 'live'
            ? 'Live workspace'
            : 'Choose a website and event.'}
      </p>
      <details className="mt-3 rounded-lg border border-[#241b3f]/10 bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold">
          Optional: try a test purchase first
        </summary>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-600">
          <li>
            Open the sandbox organiser workspace and publish a test event.
          </li>
          <li>
            Add your own local website address below, for example{' '}
            <code>http://localhost:3010</code>. Select the event and save.
          </li>
          <li>
            {setupPath === 'link'
              ? 'Create a Test checkout link. Download the test page below or paste the link into your own button.'
              : 'Create a Test key with the recommended permissions. Run the local starter from the guide below.'}
          </li>
          <li>
            Complete a Paystack Test payment and check the ticket in the
            sandbox.
          </li>
        </ol>
        <a
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
          href="/developers/local-testing"
        >
          Open local testing guide →
        </a>
      </details>
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
                1. Choose a website connection
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
                <option value="">Create a new website connection</option>
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
              New connection
            </Button>
          </div>
          <form
            onSubmit={(event) => void save(event)}
            className="mt-5 grid gap-4 rounded-xl border border-[#241b3f]/10 bg-white p-4 sm:grid-cols-2 sm:p-6"
          >
            <div className="sm:col-span-2">
              <h2 className="font-black">2. Set up this website</h2>
            </div>
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
                Website or app name
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
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="auth-label">What are you setting up?</legend>
              <div className="grid grid-cols-2 gap-3">
                {(['test', 'live'] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-bold ${connectionEnvironment === mode ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-[#241b3f]/15 bg-white'}`}
                  >
                    <input
                      type="radio"
                      name="connection-environment"
                      value={mode}
                      checked={connectionEnvironment === mode}
                      disabled={busy}
                      onChange={() => {
                        // Correct a localhost address entered before choosing Test.
                        if (mode === 'test') {
                          const lines = liveOrigins.split(/\r?\n/);
                          const local = (value: string) => {
                            try {
                              return [
                                'localhost',
                                '127.0.0.1',
                                '[::1]',
                              ].includes(new URL(value.trim()).hostname);
                            } catch {
                              return false;
                            }
                          };
                          const testing = lines.filter(local);
                          if (testing.length) {
                            setTestOrigins(
                              [
                                ...new Set(
                                  [...testOrigins.split(/\r?\n/), ...testing]
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                ),
                              ].join('\n'),
                            );
                            setLiveOrigins(
                              lines.filter((line) => !local(line)).join('\n'),
                            );
                          }
                        }
                        setConnectionEnvironment(mode);
                        setEnvironment(mode);
                        setSecret('');
                        setError('');
                        setNotice('');
                      }}
                      className="accent-emerald-600"
                    />
                    {mode === 'test'
                      ? 'Test / local website'
                      : 'Live deployment'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <label htmlFor="integration-origins" className="auth-label">
                {connectionEnvironment === 'test'
                  ? 'Test website address'
                  : 'Live website or app backend address'}
              </label>
              <textarea
                id="integration-origins"
                value={
                  connectionEnvironment === 'test' ? testOrigins : liveOrigins
                }
                onChange={(event) =>
                  connectionEnvironment === 'test'
                    ? setTestOrigins(event.target.value)
                    : setLiveOrigins(event.target.value)
                }
                disabled={busy}
                rows={3}
                className="auth-input w-full py-3"
                placeholder={
                  connectionEnvironment === 'test'
                    ? 'http://localhost:3111'
                    : 'https://events.example.com'
                }
                aria-describedby="integration-origins-help"
              />
              <p
                id="integration-origins-help"
                className="mt-1 text-xs text-slate-500"
              >
                {connectionEnvironment === 'test'
                  ? 'Use your website address, such as http://localhost:3010. No page path.'
                  : 'Use a public HTTPS address. No page path.'}
              </p>
              {eventWebsite &&
                (connectionEnvironment === 'test' || eventWebsite.startsWith('https://')) && (
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-2 text-sm font-bold text-emerald-800 underline"
                    onClick={() => {
                      const origin = new URL(eventWebsite).origin;
                      const current = connectionEnvironment === 'test' ? testOrigins : liveOrigins;
                      const next = [...new Set([...current.split(/\r?\n/), origin].map((value) => value.trim()).filter(Boolean))].join('\n');
                      if (connectionEnvironment === 'test') setTestOrigins(next);
                      else setLiveOrigins(next);
                    }}
                  >
                    Use saved event website
                  </button>
                )}
            </div>
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="auth-label">
                Events this website can sell
              </legend>
              <p className="mb-2 text-xs leading-5 text-slate-500">
                Select the events this connection may use.
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
            </fieldset>
            <div className="flex items-end sm:col-span-2">
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {busy
                  ? 'Saving…'
                  : selectedId
                    ? 'Save website settings'
                    : 'Save and continue'}
              </Button>
            </div>
          </form>
          {selected && (
            <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
              <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
                3.{' '}
                {setupPath === 'link'
                  ? 'Create your button'
                  : 'Connect your developer'}
              </p>
              <h2 className="mt-1 text-xl font-black">
                {setupPath === 'link'
                  ? 'Copy your Buy Tickets link'
                  : 'Create your server key'}
              </h2>
              {setupPath === 'api' && (
                <p className="mt-2 text-sm text-slate-700">Keep the key on your server.</p>
              )}
            </section>
          )}
          {selected && (
            <details className="mt-4 rounded-xl border border-[#241b3f]/10 bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold">
                Manage connection · {selected.status}
              </summary>
              <section
                className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#241b3f]/10 bg-white p-4 sm:p-6"
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
            </details>
          )}
          {selected && setupPath === 'link' && (
            <OrganiserHostedCheckout
              key={'hosted-' + selected.id + connectionEnvironment}
              application={selected}
              events={dashboard.events}
              defaultEnvironment={connectionEnvironment}
              settingsPending={unsavedChanges}
            />
          )}
          {setupPath === 'api' && (
            <details
              className="mt-6 rounded-xl border border-[#241b3f]/10 bg-white p-4 sm:p-6"
              open={setupPath === 'api'}
            >
              <summary className="cursor-pointer font-black">
                {setupPath === 'api'
                  ? 'Developer API setup'
                  : 'Need a developer? API keys, webhooks and widgets'}
              </summary>
              <p className="mt-2 text-sm text-slate-600">
                {setupPath === 'api'
                  ? 'Complete the three steps below. The API key stays on your developer’s server; it never belongs in website browser code.'
                  : 'A Buy Tickets link works without these tools. Open this section only if a developer needs a custom integration.'}
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
                      Step 1. Create a server key
                    </h2>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Recommended permissions cover events, availability, checkout
                    and payment confirmation.
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
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-sm font-bold text-emerald-950">
                      Recommended for a standard checkout integration
                    </p>
                    <p className="mt-1 text-xs leading-5 text-emerald-900">
                      Ready for standard ticket sales. Change permissions only
                      if needed.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      className="mt-3 bg-white"
                      onClick={() => setReadScopes(RECOMMENDED_CHECKOUT_SCOPES)}
                    >
                      Use recommended permissions
                    </Button>
                    <p className="mt-2 text-xs font-semibold text-emerald-900">
                      {readScopes.length} permission
                      {readScopes.length === 1 ? '' : 's'} selected
                    </p>
                  </div>
                  <details className="mt-4 rounded-lg border border-[#241b3f]/10 p-3">
                    <summary className="cursor-pointer text-sm font-bold">
                      Change individual permissions
                    </summary>
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
                                'availability:read':
                                  'Available ticket quantities',
                                'checkout:write': 'Create hosted checkouts',
                                'external_events:write':
                                  'Create and update externally managed events',
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
                  </details>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Existing keys keep their permissions. Create a new key after
                    changing permissions. Rotating replaces the current key with
                    the same permissions.
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
                                  disabled={
                                    busy || selected.status !== 'active'
                                  }
                                  onClick={() =>
                                    void keyAction('rotate', key.id)
                                  }
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Rotate
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void keyAction('revoke', key.id)
                                  }
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
                  <section className="mt-6 rounded-lg border border-[#241b3f]/10 bg-slate-50 p-4">
                    <h3 className="font-black">
                      Step 2. Add the key to your server
                    </h3>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-bold">
                        Assigned event IDs for your API requests
                      </summary>
                      {dashboard.events
                        .filter((event) => selected.eventIds.includes(event.id))
                        .map((event) => (
                          <label key={event.id} className="mt-3 block text-sm">
                            {event.title}
                            <input
                              readOnly
                              value={event.id}
                              aria-label={`${event.title} event ID`}
                              className="auth-input mt-1 w-full font-mono text-xs"
                              onFocus={(event) => event.currentTarget.select()}
                            />
                          </label>
                        ))}
                      {!selected.eventIds.length && (
                        <p className="mt-2 text-sm">
                          Select an event above and save first.
                        </p>
                      )}
                    </details>
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-sm leading-6 text-slate-600">
                      <li>Save the key as a private environment variable.</li>
                      <li>
                        Use it on your server to list events and create checkout
                        sessions.
                      </li>
                      <li>
                        Send the buyer to the returned secure checkout address.
                      </li>
                    </ol>
                    <a
                      className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
                      href="/developers/checkout"
                    >
                      API checkout example →
                    </a>
                    <a
                      className="flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
                      href="/developers/local-testing"
                    >
                      Run the localhost starter →
                    </a>
                  </section>
                  <section className="mt-4 rounded-lg border border-[#241b3f]/10 bg-slate-50 p-4">
                    <h3 className="font-black">
                      Step 3. Verify a completed purchase
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      After checkout returns to your website, your server checks
                      the session using <code>orders:read</code> before showing
                      a paid confirmation. Do not trust the return page alone.
                    </p>
                  </section>
                </section>
              )}
              <section className="mt-6 rounded-lg border border-[#241b3f]/10 bg-white p-4 sm:p-6">
                <h2 className="flex items-center gap-2 text-lg font-black">
                  <Code2 className="h-5 w-5 text-emerald-700" />
                  Optional: check your connection
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  From your server, send a GET request to{' '}
                  <code>/api/v1/integration</code> with{' '}
                  <code>Authorization: Bearer YOUR_SECRET_KEY</code>. The
                  response confirms the application, mode and granted
                  permissions. This endpoint does not return events, customer
                  information or tickets.
                </p>
              </section>
              <details className="mt-4 rounded-lg border border-[#241b3f]/10 bg-white p-4">
                <summary className="cursor-pointer text-sm font-bold">
                  Other developer tools: webhooks and embedded ticket checkout
                </summary>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Webhooks send automatic order updates. The widget embeds
                  ticket selection.
                </p>
                {selected && (
                  <OrganiserWebhooks
                    key={selected.id}
                    applicationId={selected.id}
                  />
                )}
                {selected && (
                  <OrganiserWidget
                    key={'widget-' + selected.id + connectionEnvironment}
                    application={selected}
                    events={dashboard.events}
                    defaultEnvironment={connectionEnvironment}
                  />
                )}
              </details>
            </details>
          )}
          {selected && setupPath === 'link' && (
            <details className="mt-5 rounded-xl border border-[#241b3f]/10 bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold">
                Optional: embed ticket selection
              </summary>
              <OrganiserWidget
                key={'no-code-widget-' + selected.id + connectionEnvironment}
                application={selected}
                events={dashboard.events}
                defaultEnvironment={connectionEnvironment}
              />
            </details>
          )}
          {selected && setupPath === 'api' && (
            <details className="mt-5 rounded-xl border border-emerald-200 bg-white p-4 sm:p-6">
              <summary className="cursor-pointer font-black">
                Prefer the no-code Buy Tickets link instead?
              </summary>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use this if you do not need custom event pages or a developer.
              </p>
              <OrganiserHostedCheckout
                key={'hosted-' + selected.id + connectionEnvironment}
                application={selected}
                events={dashboard.events}
                defaultEnvironment={connectionEnvironment}
                settingsPending={unsavedChanges}
              />
            </details>
          )}
        </>
      )}
    </div>
  );
}
