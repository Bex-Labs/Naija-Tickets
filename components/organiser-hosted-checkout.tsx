'use client';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { accountFetch } from '@/lib/supabase/account-fetch';
import type {
  IntegrationApplication,
  IntegrationDashboard,
} from '@/lib/integrations/types';
import type { HostedReport } from '@/lib/integrations/hosted-report';
import { IntegrationSalesReport } from './integration-sales-report';
import { hostedLinkTestPage } from '@/lib/integrations/test-page';
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
  defaultEnvironment = 'live',
  settingsPending = false,
}: {
  application: IntegrationApplication;
  events: IntegrationDashboard['events'];
  defaultEnvironment?: 'test' | 'live';
  settingsPending?: boolean;
}) {
  const available = events.filter(
    (e) => e.status === 'published' && application.eventIds.includes(e.id),
  );
  const [event, setEvent] = useState(available[0]?.id ?? ''),
    [mode, setMode] = useState<'test' | 'live'>(defaultEnvironment),
    [returnUrl, setReturnUrl] = useState<string | null>(null),
    [links, setLinks] = useState<Link[]>([]),
    [origin, setOrigin] = useState(''),
    [platformAvailable, setPlatformAvailable] = useState<boolean | null>(null),
    [paymentsReady, setPaymentsReady] = useState<boolean | null>(null),
    [paymentMode, setPaymentMode] = useState<'test' | 'live' | null>(null),
    [serverEnvironment, setServerEnvironment] = useState<
      'live' | 'test' | null
    >(null),
    [loadFailed, setLoadFailed] = useState(false),
    [refresh, setRefresh] = useState(0),
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
        paymentsReady?: boolean;
        paymentMode?: 'test' | 'live' | null;
        environment?: 'live' | 'test' | null;
      };
      error?: { message?: string };
    };
    if (!response.ok || !result.data)
      throw new Error(
        result.error?.message || 'Hosted checkout could not be loaded.',
      );
    if (typeof result.data.hostedLinksAvailable !== 'boolean')
      throw new Error(
        'Checkout settings are out of date. Restart this app and refresh the page.',
      );
    setLinks(result.data.links);
    setOrigin(result.data.origin);
    setPlatformAvailable(result.data.hostedLinksAvailable === true);
    setPaymentsReady(
      typeof result.data.paymentsReady === 'boolean'
        ? result.data.paymentsReady
        : null,
    );
    setServerEnvironment(result.data.environment || null);
    setPaymentMode(result.data.paymentMode || null);
    setReport(result.data.report);
  }, [endpoint]);
  useEffect(() => {
    void (async () => {
      try {
        await load();
        setLoadFailed(false);
        setError('');
      } catch (cause) {
        setPlatformAvailable(null);
        setLoadFailed(true);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Hosted checkout unavailable.',
        );
      }
    })();
  }, [load, refresh]);
  const activeEvent = available.some((item) => item.id === event)
    ? event
    : (available[0]?.id ?? '');
  const selected = links.find(
      (l) => l.eventId === activeEvent && l.environment === mode,
    ),
    registered = application.domains.filter((d) => d.environment === mode);
  const eventWebsite = available.find((item) => item.id === activeEvent)?.websiteUrl;
  const suggestedReturnUrl = (() => {
    if (!eventWebsite) return null;
    try {
      const url = new URL(eventWebsite);
      return !url.search && !url.hash &&
        registered.some((domain) => domain.origin === url.origin)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  })();
  const blockedReason = busy
    ? 'Saving your checkout link…'
    : settingsPending
      ? 'Save your website connection changes above first.'
      : loadFailed
        ? 'Retry loading checkout settings first.'
        : platformAvailable === null
          ? 'Checking checkout settings…'
          : platformAvailable !== true
            ? 'Hosted checkout must be activated on this server first.'
            : serverEnvironment && mode !== serverEnvironment
              ? `Test and Live use separate workspaces. Choose ${serverEnvironment === 'live' ? 'Live' : 'Test'} to create a link here.`
              : !activeEvent
                ? 'Select and save a published event in your website connection above.'
                : !registered.length
                  ? `Choose ${mode === 'live' ? 'Live deployment' : 'Test / local website'} above, add your ${mode === 'live' ? 'HTTPS ' : ''}website address, then save your connection.`
                  : application.status !== 'active'
                    ? 'Enable this website connection first.'
                    : '';
  async function save(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blockedReason) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const destination =
        returnUrl ??
        selected?.returnUrl ??
        suggestedReturnUrl ??
        (registered[0] ? registered[0].origin + '/' : '');
      if (
        !registered.some((item) => item.origin === new URL(destination).origin)
      )
        throw new Error(
          `Add ${new URL(destination).origin} to your ${mode} website addresses and save the connection first.`,
        );
      const response = await accountFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: activeEvent,
          environment: mode,
          return_url: destination,
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
  function downloadTestPage() {
    try {
      const blob = new Blob([hostedLinkTestPage(url)], { type: 'text/html' });
      const address = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = address;
      anchor.download = 'buy-tickets.html';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(address), 1000);
      setNotice(
        'Downloaded buy-tickets.html. Open it to try your button. The return address must still be running.',
      );
    } catch {
      setError('Create a valid checkout link before downloading a test page.');
    }
  }
  return (
    <section className="mt-6 min-w-0 rounded-xl border border-emerald-700/20 bg-white p-4 sm:p-6">
      <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
        No coding needed
      </p>
      <h2 className="mt-2 text-2xl font-black">Create a Buy Tickets link</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Choose an event and where buyers should return. Copy the link into your
        website’s button.
      </p>
      {settingsPending && (
        <output className="mt-4 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Save your connection changes above before creating or copying a link.
          The existing website still uses the last saved event permissions.
        </output>
      )}
      {platformAvailable === false && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {mode === 'live' ? 'Live' : 'Test'} checkout needs platform activation
          on {origin || 'this server'}. Ask the platform administrator to
          configure hosted checkout and matching payment settings.
        </p>
      )}
      {platformAvailable === true && (
        <p className="mt-3 break-words text-xs text-emerald-800">
          Checkout enabled · {origin}
        </p>
      )}
      {platformAvailable === true && paymentsReady === false && (
        <output
          className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          You can create checkout links. Paid checkout still needs a Paystack
          secret matching the server’s configured payment mode. Paid purchases
          remain blocked until then.
        </output>
      )}
      {paymentsReady && paymentMode === 'test' && (
        <output
          className="mt-3 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          Paystack Test payments are enabled on this website. No real money will
          be charged. Test bookings are recorded against the selected events.
        </output>
      )}
      {platformAvailable === true &&
        serverEnvironment &&
        mode !== serverEnvironment && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <p>
              This is a {serverEnvironment === 'live' ? 'Live' : 'Test'}{' '}
              workspace.
              {serverEnvironment === 'live'
                ? ' Test links use your separate sandbox account and event.'
                : ' Live links use your main organiser account and event.'}
            </p>
            <button
              type="button"
              disabled={busy || settingsPending}
              onClick={() => {
                setMode(serverEnvironment);
                setReturnUrl(null);
                setError('');
                setNotice('');
              }}
              className="mt-2 min-h-11 rounded-lg border border-amber-400 bg-white px-4 font-bold disabled:opacity-50"
            >
              Use {serverEnvironment === 'live' ? 'Live' : 'Test'} here
            </button>
          </div>
        )}
      {loadFailed && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          Checkout settings could not be loaded. Retry before creating a link.
          <button
            type="button"
            onClick={() => {
              setPlatformAvailable(null);
              setLoadFailed(false);
              setError('');
              setRefresh((value) => value + 1);
            }}
            className="ml-3 min-h-11 font-bold underline"
          >
            Retry loading settings
          </button>
        </div>
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
            <option value="live">Live</option>
            <option value="test">Test (optional sandbox)</option>
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
              suggestedReturnUrl ??
              (registered[0] ? registered[0].origin + '/' : '')
            }
            onChange={(e) => setReturnUrl(e.target.value)}
            placeholder="https://your-website.example/events"
          />
          <span className="mt-2 block text-xs font-normal text-slate-500">
            A page on your saved {mode} website, for example
            https://events.example.com/thank-you.
          </span>
        </label>
        <button
          disabled={Boolean(blockedReason)}
          aria-describedby={
            blockedReason ? 'hosted-link-blocked-reason' : undefined
          }
          className="min-h-11 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-50"
        >
          {loadFailed
            ? 'Load checkout settings first'
            : platformAvailable === null
              ? 'Checking checkout availability…'
              : busy
                ? 'Saving…'
                : selected
                  ? 'Update / enable checkout link'
                  : 'Create checkout link'}
        </button>
        {blockedReason && (
          <output
            id="hosted-link-blocked-reason"
            className="block text-sm text-amber-950 sm:col-span-2"
          >
            {blockedReason}
          </output>
        )}
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
          {mode === 'test' && selected.enabled && (
            <button
              type="button"
              onClick={downloadTestPage}
              className="ml-4 inline-flex min-h-11 items-center text-sm font-bold text-emerald-800 underline"
            >
              Download test website
            </button>
          )}
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
      {report && (
        <details className="mt-6 border-t pt-4">
          <summary className="cursor-pointer font-bold">
            Sales from this connection
          </summary>
          <IntegrationSalesReport report={report} />
        </details>
      )}
    </section>
  );
}
