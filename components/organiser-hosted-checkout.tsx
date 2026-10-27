'use client';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { accountFetch } from '@/lib/supabase/account-fetch';
import type {
  IntegrationApplication,
  IntegrationDashboard,
} from '@/lib/integrations/types';
import type { HostedReport } from '@/lib/integrations/hosted-report';
import { IntegrationSalesReport } from './integration-sales-report';
type Link = {
  id: string;
  publicId: string;
  eventId: string;
  environment: 'test' | 'live';
  returnUrl: string;
  cancelUrl: string;
  enabled: boolean;
};
export function OrganiserHostedCheckout({
  application,
  events,
  settingsPending = false,
}: {
  application: IntegrationApplication;
  events: IntegrationDashboard['events'];
  settingsPending?: boolean;
}) {
  const available = events.filter(
    (e) => e.status === 'published' && application.eventIds.includes(e.id),
  );
  const [event, setEvent] = useState(available[0]?.id ?? ''),
    [mode, setMode] = useState<'test' | 'live'>('test'),
    [returnUrl, setReturnUrl] = useState<string | null>(null),
    [links, setLinks] = useState<Link[]>([]),
    [origin, setOrigin] = useState(''),
    [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null),
    [report, setReport] = useState<HostedReport | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const endpoint = `/api/organiser/integrations/${application.id}/hosted-links`;
  const load = useCallback(async () => {
    const response = await accountFetch(endpoint, { cache: 'no-store' });
    const result = (await response.json()) as {
      data?: {
        links: Link[];
        origin: string;
        report: HostedReport;
        hostedLinksAvailable?: boolean;
      };
      error?: { message?: string };
    };
    if (!response.ok || !result.data)
      throw new Error(
        result.error?.message || 'Hosted checkout could not be loaded.',
      );
    setLinks(result.data.links);
    setOrigin(result.data.origin);
    setPlatformAvailable(result.data.hostedLinksAvailable === true);
    setReport(result.data.report);
  }, [endpoint]);
  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (cause) {
        setPlatformAvailable(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Hosted checkout unavailable.',
        );
      }
    })();
  }, [load]);
  const activeEvent = available.some((item) => item.id === event)
    ? event
    : (available[0]?.id ?? '');
  const selected = links.find(
      (l) => l.eventId === activeEvent && l.environment === mode,
    ),
    registered = application.domains.filter((d) => d.environment === mode);
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (settingsPending || platformAvailable !== true) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await accountFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: activeEvent,
          environment: mode,
          return_url:
            returnUrl ??
            selected?.returnUrl ??
            (registered[0] ? registered[0].origin + '/' : ''),
          enabled: true,
        }),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(
          result.error?.message || 'The checkout link could not be created.',
        );
      await load();
      setNotice('Hosted checkout link saved. No API key is needed to use it.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Link unavailable.');
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await accountFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: activeEvent,
          environment: mode,
          return_url: selected.returnUrl,
          cancel_url: selected.cancelUrl,
          enabled: false,
        }),
      });
      if (!response.ok) throw new Error('Could not disable this link.');
      await load();
      setNotice(
        'Link disabled. Existing unpaid checkouts from this link are blocked.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not disable link.',
      );
    } finally {
      setBusy(false);
    }
  }
  const url = selected ? `${origin}/checkout/link/${selected.publicId}` : '',
    snippet = url ? `<a href="${url}">Buy Tickets</a>` : '';
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Copied.');
    } catch {
      setNotice('Select and copy the text below.');
    }
  }
  return (
    <section className="mt-6 min-w-0 rounded-xl border border-emerald-700/20 bg-white p-4 sm:p-6">
      <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
        No coding needed
      </p>
      <h2 className="mt-2 text-2xl font-black">Create a Buy Tickets link</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        <strong>Hosted Checkout Link:</strong> no programming or API key
        required. Add a Buy Tickets button to your website. Customers choose
        tickets and pay on a focused Naija Tickets page, then return to your
        approved website.
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        You do not need API keys, a server or a webhook. Naija Tickets handles
        ticket selection, payment verification and ticket delivery. Your website
        builder only needs to support a button with a website link.
      </p>
      {settingsPending && (
        <output className="mt-4 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Save your connection changes above before creating or copying a link.
          The existing website still uses the last saved event permissions.
        </output>
      )}
      {platformAvailable === false && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Checkout links are unavailable on this app. Test links must be created
          in the separate sandbox organiser workspace, using a sandbox account
          and event. Main-site accounts and events are separate, even when
          Paystack uses Test payments. For Live links, the platform
          administrator must activate hosted checkout on the main app.
        </p>
      )}
      <form
        onSubmit={(e) => void save(e)}
        className="mt-5 grid gap-4 sm:grid-cols-2"
      >
        <label className="auth-label">
          Event
          <select
            className="auth-input mt-2 w-full bg-white"
            value={activeEvent}
            onChange={(e) => {
              setEvent(e.target.value);
              setReturnUrl(null);
            }}
            disabled={busy || settingsPending}
          >
            {!available.length && (
              <option value="">Assign a published event first</option>
            )}
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label className="auth-label">
          Environment
          <select
            className="auth-input mt-2 w-full bg-white"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as 'test' | 'live');
              setReturnUrl(null);
            }}
            disabled={busy || settingsPending}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label className="auth-label sm:col-span-2">
          Return to your website
          <input
            className="auth-input mt-2 w-full"
            type="url"
            required
            disabled={busy || settingsPending}
            value={
              returnUrl ??
              selected?.returnUrl ??
              (registered[0] ? registered[0].origin + '/' : '')
            }
            onChange={(e) => setReturnUrl(e.target.value)}
            placeholder="https://your-website.example/events"
          />
          <span className="mt-2 block text-xs font-normal text-slate-500">
            Use one of your registered {mode} website origins above. No query,
            fragment or login credentials. Test links require an isolated
            sandbox deployment.
          </span>
        </label>
        <button
          disabled={
            busy ||
            settingsPending ||
            platformAvailable !== true ||
            !activeEvent ||
            !registered.length ||
            application.status !== 'active'
          }
          className="min-h-11 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-50"
        >
          {platformAvailable === null
            ? 'Checking checkout availability…'
            : busy
              ? 'Saving…'
              : selected
                ? 'Update / enable checkout link'
                : 'Create checkout link'}
        </button>
        {selected && (
          <button
            type="button"
            disabled={busy || !selected.enabled}
            onClick={() => void disable()}
            className="min-h-11 rounded-lg border px-4 text-sm font-bold"
          >
            Disable link
          </button>
        )}
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-4 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      {!registered.length && (
        <p className="mt-3 text-sm text-slate-600">
          Add your website address under {mode === 'test' ? 'Test' : 'Live'}{' '}
          website origins above, then save the connection first.
        </p>
      )}
      {selected && !settingsPending && platformAvailable === true && (
        <div className="mt-5 space-y-3">
          <p className="text-sm font-bold">
            Link {selected.enabled ? 'enabled' : 'disabled'}
          </p>
          <label className="auth-label">
            Your checkout link
            <input
              readOnly
              value={url}
              className="auth-input mt-2 w-full font-mono text-xs"
            />
          </label>
          <button
            type="button"
            className="min-h-11 text-sm font-bold text-emerald-800 underline"
            onClick={() => void copy(url)}
          >
            Copy checkout link
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 inline-flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
          >
            Preview checkout
          </a>
          <ol className="list-inside list-decimal space-y-1 rounded-lg bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
            <li>Open your website builder and add a button.</li>
            <li>Name it Buy Tickets and choose Website address or Link.</li>
            <li>
              Paste the copied checkout link, save and publish your website.
            </li>
            <li>
              Click your button and complete a{' '}
              {mode === 'test' ? 'test purchase' : 'purchase'} to check the
              experience.
            </li>
          </ol>
          <p className="text-xs leading-5 text-slate-500">
            Buyers receive their purchase result and ticket access on the secure
            checkout. A success message on your own website requires a developer
            to verify the payment; returning to your website alone is not proof
            of payment.
          </p>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-bold">
              Optional HTML button · for a custom-code block
            </summary>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
              {snippet}
            </pre>
            <button
              className="min-h-11 text-sm font-bold text-emerald-800 underline"
              onClick={() => void copy(snippet)}
            >
              Copy HTML button
            </button>
          </details>
        </div>
      )}
      <details className="mt-6 border-t pt-5">
        <summary className="cursor-pointer font-black">
          Hosted Checkout API · for developers
        </summary>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Create sessions from your server using a key with checkout:write. Send
          the event ID; ticket selections and buyer prefill are optional.
          Redirect the buyer to checkout_url. Keep secret keys on your server
          and verify purchases using orders:read.
        </p>
        <a
          className="mt-2 inline-flex min-h-11 items-center font-bold text-emerald-800 underline"
          href="/developers/checkout"
        >
          Read integration instructions →
        </a>
      </details>
      {report && <IntegrationSalesReport report={report} />}
    </section>
  );
}
