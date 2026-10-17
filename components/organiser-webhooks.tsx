'use client';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { accountFetch } from '@/lib/supabase/account-fetch';
import {
  WEBHOOK_EVENTS,
  type WebhookDashboard,
} from '@/lib/integrations/webhook-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function OrganiserWebhooks({
  applicationId,
}: {
  applicationId: string;
}) {
  const [state, setState] = useState<WebhookDashboard | null>(null);
  const [url, setUrl] = useState(''),
    [mode, setMode] = useState('test');
  const [events, setEvents] = useState<string[]>(['order.paid']);
  const [error, setError] = useState(''),
    [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const base = `/api/organiser/integrations/${applicationId}/webhooks`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await accountFetch(
          base + (cursor ? `?before=${encodeURIComponent(cursor)}` : ''),
          { signal: controller.signal, cache: 'no-store' },
        );
        const result = (await response.json()) as {
          data?: WebhookDashboard;
          error?: { message?: string };
        };
        if (!response.ok || !result.data)
          throw new Error(
            result.error?.message || 'Webhooks could not be loaded.',
          );
        if (!controller.signal.aborted) {
          setState(result.data);
          setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Webhooks could not be loaded.',
          );
      }
    })();
    return () => controller.abort();
  }, [base, cursor, reload]);
  useEffect(() => {
    if (!secret) return;
    const timeout = window.setTimeout(() => setSecret(''), 60000);
    return () => window.clearTimeout(timeout);
  }, [secret]);
  async function change(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    setSecret('');
    try {
      const response = await accountFetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = (await response.json()) as {
        data?: { secret?: string };
        error?: { message?: string };
      };
      if (!response.ok || !result.data)
        throw new Error(result.error?.message || 'Webhook update failed.');
      if (result.data.secret) setSecret(result.data.secret);
      setCursor(null);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Webhook update failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void change('', 'POST', { url, environment: mode, events });
  }
  return (
    <section
      className="mt-6 min-w-0 border border-[#241b3f]/10 bg-white p-4 sm:p-6"
      aria-labelledby="webhook-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="webhook-title" className="text-xl font-black">
          Webhook notifications
        </h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Send signed updates to your server when a booking changes. Use a public
        HTTPS address on one of this application’s registered websites. Test
        notifications stay in the sandbox.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        The initial free Vercel schedule runs daily. Notifications may be
        delayed; pending work is stored until a dispatcher runs. Each delivery
        can arrive more than once.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {secret && (
        <div className="mt-4 border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold">
            Save this signing secret on your server. It is shown once and hidden
            after one minute.
          </p>
          <code className="mt-2 block break-all select-all text-xs">
            {secret}
          </code>
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(secret)
                  .catch(() => setError('Select and copy the secret above.'))
              }
            >
              Copy secret
            </Button>
            <Button variant="outline" onClick={() => setSecret('')}>
              Hide
            </Button>
          </div>
        </div>
      )}
      <form
        onSubmit={create}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_auto]"
      >
        <div className="min-w-0">
          <label htmlFor="webhook-url" className="auth-label">
            Webhook URL
          </label>
          <Input
            id="webhook-url"
            type="url"
            required
            maxLength={2048}
            className="auth-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://your-website.com/api/webhooks/naija-tickets"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="webhook-mode" className="auth-label">
            Environment
          </label>
          <select
            id="webhook-mode"
            className="auth-input w-full bg-white"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            disabled={busy}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </div>
        <Button
          type="submit"
          className="self-end bg-emerald-600 text-white"
          disabled={
            busy ||
            !events.length ||
            (state?.endpoints.filter((endpoint) => !endpoint.retiredAt)
              .length || 0) >= 3
          }
        >
          Add endpoint
        </Button>
        <fieldset className="grid gap-2 sm:col-span-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">
            Updates to send
          </legend>
          {WEBHOOK_EVENTS.map((type) => (
            <label
              key={type}
              className="flex min-h-8 items-center gap-2 text-xs"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={events.includes(type)}
                disabled={busy}
                onChange={(event) =>
                  setEvents((current) =>
                    event.target.checked
                      ? [...current, type]
                      : current.filter((item) => item !== type),
                  )
                }
              />
              {type}
            </label>
          ))}
        </fieldset>
      </form>
      <div className="mt-5 space-y-3">
        {state?.endpoints.map((endpoint) => (
          <div
            key={endpoint.id}
            className="border-t border-slate-200 pt-3 text-sm"
          >
            <p className="break-all font-semibold">{endpoint.url}</p>
            <p className="mt-1 text-xs text-slate-500">
              {endpoint.environment} ·{' '}
              {endpoint.retiredAt
                ? 'Retired'
                : endpoint.enabled
                  ? 'Enabled'
                  : 'Paused'}{' '}
              · {endpoint.events.join(', ')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || Boolean(endpoint.retiredAt)}
                onClick={() =>
                  void change(`/${endpoint.id}`, 'PATCH', {
                    enabled: !endpoint.enabled,
                  })
                }
              >
                {endpoint.enabled ? 'Pause' : 'Enable'}
              </Button>
              <Button
                variant="outline"
                disabled={busy || Boolean(endpoint.retiredAt)}
                onClick={() =>
                  void change(`/${endpoint.id}`, 'PATCH', {
                    enabled: false,
                    rotate: true,
                  })
                }
              >
                Rotate secret &amp; pause
              </Button>
              <Button
                variant="outline"
                disabled={busy || Boolean(endpoint.retiredAt)}
                onClick={() => void change(`/${endpoint.id}`, 'DELETE')}
              >
                Retire endpoint
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="font-bold">Delivery history</h3>
        {!state?.deliveries.length && (
          <p className="mt-2 text-sm text-slate-500">
            No deliveries on this page.
          </p>
        )}
        {state?.deliveries.map((delivery) => (
          <details key={delivery.id} className="border-b border-slate-100 py-3">
            <summary className="cursor-pointer text-sm">
              <span className="font-semibold">{delivery.type}</span> ·{' '}
              {delivery.status} · {delivery.attempts} attempts
            </summary>
            <p className="mt-2 break-all text-xs text-slate-500">
              Event: {delivery.eventId}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Created {new Date(delivery.createdAt).toLocaleString()}
            </p>
            {delivery.history.map((attempt) => (
              <p key={attempt.attempt} className="mt-1 text-xs">
                Attempt {attempt.attempt}: {attempt.outcome || 'In progress'}
                {attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ''}
              </p>
            ))}
            {delivery.status === 'exhausted' && (
              <Button
                variant="outline"
                className="mt-2"
                disabled={
                  busy ||
                  Boolean(
                    state.endpoints.find(
                      (endpoint) => endpoint.id === delivery.endpointId,
                    )?.retiredAt,
                  )
                }
                onClick={() =>
                  void change(`/deliveries/${delivery.id}/retry`, 'POST')
                }
              >
                Retry delivery
              </Button>
            )}
          </details>
        ))}
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            disabled={!cursor || busy}
            onClick={() => setCursor(null)}
          >
            Latest
          </Button>
          <Button
            variant="outline"
            disabled={!state?.nextCursor || busy}
            onClick={() => setCursor(state?.nextCursor || null)}
          >
            Older deliveries
          </Button>
        </div>
      </div>
    </section>
  );
}
