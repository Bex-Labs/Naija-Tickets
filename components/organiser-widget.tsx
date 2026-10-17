'use client';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { accountFetch } from '@/lib/supabase/account-fetch';
import type {
  IntegrationApplication,
  IntegrationDashboard,
} from '@/lib/integrations/types';
import type { WidgetConfiguration } from '@/lib/integrations/widget-types';
import { widgetSnippet } from '@/lib/integrations/widget-snippet';
import { Button } from '@/components/ui/button';
type Settings = WidgetConfiguration & { widgetOrigin: string };
export function OrganiserWidget({
  application,
  events,
}: {
  application: IntegrationApplication;
  events: IntegrationDashboard['events'];
}) {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light'),
    [accent, setAccent] = useState<'green' | 'blue' | 'violet'>('green'),
    [button, setButton] = useState<'rounded' | 'square'>('rounded');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [enabled, setEnabled] = useState(false),
    [checkout, setCheckout] = useState(false);
  const [eventId, setEventId] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const available = events.filter(
    (event) =>
      application.eventIds.includes(event.id) && event.status === 'published',
  );
  const selected = available.some((event) => event.id === eventId)
    ? eventId
    : available[0]?.id || '';
  const endpoint = `/api/organiser/integrations/${application.id}/widget`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await accountFetch(`${endpoint}?environment=${mode}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          data?: Settings;
          error?: { message?: string };
        };
        if (!response.ok || !result.data)
          throw new Error(
            result.error?.message || 'Widget settings could not be loaded.',
          );
        if (!controller.signal.aborted) {
          setSettings(result.data);
          setEnabled(result.data.enabled);
          setCheckout(result.data.checkoutEnabled);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Widget settings unavailable.',
          );
      }
    })();
    return () => controller.abort();
  }, [endpoint, mode]);
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await accountFetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: mode,
          enabled,
          checkoutEnabled: checkout,
        }),
      });
      const result = (await response.json()) as {
        data?: Settings;
        error?: { message?: string };
      };
      if (!response.ok || !result.data)
        throw new Error(
          result.error?.message || 'Widget settings could not be saved.',
        );
      setSettings(result.data);
      setNotice(
        'Widget settings saved. Existing unpaid widget checkouts need a fresh selection.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Widget settings could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }
  const snippet =
    selected && settings
      ? widgetSnippet(settings.widgetOrigin, {
          widgetId: application.widgetId,
          eventId: selected,
          environment: mode,
          appearance,
          accent,
          button,
        })
      : '';
  return (
    <section
      className="mt-6 min-w-0 border border-[#241b3f]/10 bg-white p-4 sm:p-6"
      aria-labelledby="widget-heading"
    >
      <h2 id="widget-heading" className="text-xl font-black">
        Embed ticket selection
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Show ticket choices on a registered website. Buyers continue to Naija
        Tickets to enter their details and pay. Only assigned, published and
        upcoming events can load.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <output className="mt-3 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      <form
        onSubmit={(event) => void save(event)}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <div>
          <label className="auth-label" htmlFor="widget-environment">
            Widget environment
          </label>
          <select
            id="widget-environment"
            className="auth-input w-full bg-white"
            value={mode}
            disabled={busy}
            onChange={(event) => {
              setSettings(null);
              setError('');
              setNotice('');
              setMode(event.target.value as 'test' | 'live');
            }}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div className="space-y-2 pt-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={enabled}
              disabled={busy || !settings}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable public ticket widget
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={checkout}
              disabled={busy || !settings}
              onChange={(event) => setCheckout(event.target.checked)}
            />
            Allow hosted checkout
          </label>
        </div>
        <Button
          type="submit"
          className="bg-emerald-600 text-white sm:col-span-2"
          disabled={busy || !settings}
        >
          {busy ? 'Saving…' : 'Save widget settings'}
        </Button>
      </form>
      <p className="mt-3 text-xs text-slate-500">
        Register the embedding website in the matching Test or Live origins.
        Widgets also require server configuration. Changing settings blocks new
        unpaid widget purchases.
      </p>
      <div className="mt-4">
        <label htmlFor="widget-event" className="auth-label">
          Event to embed
        </label>
        <select
          id="widget-event"
          className="auth-input w-full bg-white"
          value={selected}
          onChange={(event) => setEventId(event.target.value)}
        >
          {!available.length && (
            <option value="">Assign a published event first</option>
          )}
          {available.map((event) => (
            <option key={event.id} value={event.id}>
              {event.title}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="widget-appearance" className="auth-label">
            Appearance
          </label>
          <select
            id="widget-appearance"
            className="auth-input w-full bg-white"
            value={appearance}
            onChange={(e) => setAppearance(e.target.value as 'light' | 'dark')}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div>
          <label htmlFor="widget-accent" className="auth-label">
            Primary colour
          </label>
          <select
            id="widget-accent"
            className="auth-input w-full bg-white"
            value={accent}
            onChange={(e) =>
              setAccent(e.target.value as 'green' | 'blue' | 'violet')
            }
          >
            <option value="green">Naija green</option>
            <option value="blue">Blue</option>
            <option value="violet">Violet</option>
          </select>
        </div>
        <div>
          <label htmlFor="widget-button" className="auth-label">
            Button style
          </label>
          <select
            id="widget-button"
            className="auth-input w-full bg-white"
            value={button}
            onChange={(e) => setButton(e.target.value as 'rounded' | 'square')}
          >
            <option value="rounded">Rounded</option>
            <option value="square">Square</option>
          </select>
        </div>
      </div>
      {!!snippet && (
        <>
          <label className="auth-label mt-3" htmlFor="widget-snippet">
            Public embed snippet
          </label>
          <textarea
            id="widget-snippet"
            readOnly
            rows={4}
            className="auth-input w-full py-3 font-mono text-xs"
            value={snippet}
          />
          <Button
            className="mt-2"
            variant="outline"
            disabled={!settings?.enabled}
            onClick={() =>
              void navigator.clipboard
                .writeText(snippet)
                .then(() => setNotice('Embed snippet copied.'))
                .catch(() => setError('Select and copy the snippet above.'))
            }
          >
            Copy snippet
          </Button>
        </>
      )}
      <p className="mt-2 text-xs text-slate-500">
        The snippet contains a public widget ID. Never add an API secret to it.
        Keep API keys on your server.
      </p>
    </section>
  );
}
