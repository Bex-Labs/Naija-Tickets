// A runnable minimal partner, with no third-party runtime dependencies.
// Use persistent account/order ownership in a real application; this example
// binds the most recent purchase to a signed, short-lived browser cookie.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
class ExampleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function config(env) {
  let api, partner;
  try {
    api = new URL(env.NT_API_ORIGIN);
    partner = new URL(env.NT_PARTNER_ORIGIN);
  } catch {
    throw new ExampleError(
      'SETUP_ADDRESS',
      'Set NT_API_ORIGIN to Naija Tickets and NT_PARTNER_ORIGIN to this website’s address in .env.local, then restart the server.',
    );
  }
  const path = env.NT_EXAMPLE_PATH || '/',
    mode = env.NT_MODE || 'test',
    key = env.NT_API_KEY,
    secret = env.NT_EXAMPLE_COOKIE_SECRET;
  for (const url of [api, partner])
    if (
      url.origin + '/' !== url.href ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(
          mode === 'test' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    )
      throw new ExampleError(
        'SETUP_ADDRESS',
        'Use base addresses without a page path. Local HTTP is supported in Test mode; Live requires HTTPS.',
      );
  if (
    !['test', 'live'].includes(mode) ||
    !new RegExp('^nt_' + mode + '_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$').test(
      key || '',
    )
  )
    throw new ExampleError(
      'SETUP_KEY',
      'Set NT_API_KEY to your matching Test or Live server key in .env.local, then restart this server. Never use a VITE_ or NEXT_PUBLIC_ variable.',
    );
  if (env.NT_EVENT_ID && !uuid.test(env.NT_EVENT_ID))
    throw new ExampleError(
      'SETUP_EVENT',
      'NT_EVENT_ID must be an assigned event ID. Leave it blank to choose an event from the API.',
    );
  if (!secret || secret.length < 43 || secret === key)
    throw new ExampleError(
      'SETUP_COOKIE',
      'Configure a dedicated NT_EXAMPLE_COOKIE_SECRET of at least 43 characters on the server. The local Node starter generates one automatically for Test mode.',
    );
  if (!/^\/[A-Za-z0-9_/-]*$/.test(path) || path.startsWith('//'))
    throw new ExampleError(
      'SETUP_ROUTE',
      'Use a server route such as /api/tickets/checkout for NT_EXAMPLE_PATH.',
    );
  return {
    api: api.origin,
    partner: partner.origin,
    path,
    mode,
    key,
    secret,
    eventId: env.NT_EVENT_ID || '',
  };
}
const upstreamErrors = {
  INVALID_API_KEY:
    'The API key was rejected. Check NT_API_KEY, its mode, expiry and whether the connection is active; restart after changing .env.local.',
  INSUFFICIENT_SCOPE:
    'This key needs events:read to choose events, checkout:write to start checkout and orders:read to verify payment. Generate a key with the recommended checkout permissions.',
  NOT_FOUND:
    'The event is unavailable or not assigned to this connection. Select an upcoming published event and save the website settings.',
  INVALID_REQUEST:
    'Check the event and return address. Register this website’s exact base address in the matching Test or Live connection.',
  CHECKOUT_CONFLICT:
    'This checkout conflicts with an earlier attempt or current ticket availability. Reload the page to start again.',
  SANDBOX_NOT_CONFIGURED:
    'Test checkout is not configured on this Naija Tickets server. Check single-project testing settings; a second sandbox is not required.',
  TESTING_UNAVAILABLE:
    'Test checkout is unavailable on the configured Naija Tickets server. Check single-project testing and the API origin.',
  LIVE_PAYMENTS_UNAVAILABLE:
    'Real payments are not enabled on Naija Tickets. Use Test mode for rehearsals or activate Live payments on the platform.',
};
function seal(value, secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return (
    payload +
    '.' +
    createHmac('sha256', secret)
      .update('nt.hosted.example.v1.' + payload)
      .digest('base64url')
  );
}
function unseal(value, secret) {
  try {
    const [payload, signature] = value.split('.');
    const actual = Buffer.from(signature, 'base64url'),
      expected = createHmac('sha256', secret)
        .update('nt.hosted.example.v1.' + payload)
        .digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const state = JSON.parse(Buffer.from(payload, 'base64url'));
    return uuid.test(state.intent) && state.exp > Date.now() ? state : null;
  } catch {
    return null;
  }
}
async function smallForm(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing form');
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel(), 5000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) throw new Error('Form too large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function handleHostedExample(
  request,
  env = process.env,
  fetchImpl = fetch,
) {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
  const page = (text, status = 200) =>
    new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Naija Tickets API example</title><style>body{margin:0;background:#fffaf0;color:#241b3f;font:16px/1.6 system-ui}main{max-width:520px;margin:8vh auto;padding:24px}button,select{font:inherit;padding:12px;border:1px solid #ccc;border-radius:8px}button{display:block;margin-top:16px;background:#008f66;color:white;font-weight:700;cursor:pointer}select{width:100%;background:white}code{overflow-wrap:anywhere}a{color:#008f66}</style><main><h1>Buy event tickets</h1>' +
        text +
        '</main></html>',
      { status, headers },
    );
  try {
    const c = config(env),
      url = new URL(request.url);
    if (url.origin !== c.partner || url.pathname !== c.path)
      return page('<p>Not found.</p>', 404);
    const raw =
      (request.headers.get('cookie') || '')
        .split('; ')
        .find((x) => x.startsWith('nt_example='))
        ?.slice(11) || '';
    let state = unseal(raw, c.secret);
    const call = async (path, body, requireMode = true) => {
      let response;
      try {
        response = await fetchImpl(c.api + path, {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: 'Bearer ' + c.key,
            ...(body
              ? {
                  'Content-Type': 'application/json',
                  'Idempotency-Key': state.intent,
                }
              : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
          cache: 'no-store',
        });
      } catch {
        throw new ExampleError(
          'API_UNREACHABLE',
          'Cannot reach Naija Tickets. Check NT_API_ORIGIN and start its local server if you are using localhost.',
        );
      }
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const code = result?.error?.code || 'API_ERROR';
        throw new ExampleError(
          code,
          upstreamErrors[code] ||
            'Naija Tickets could not start checkout. Check the saved website address, event permissions and server configuration.',
        );
      }
      if (!result?.data || (requireMode && result.data.environment !== c.mode))
        throw new ExampleError(
          'API_MODE_MISMATCH',
          'The response does not match NT_MODE. Use the Test key for testing and the Live key for real purchases.',
        );
      return result.data;
    };
    if (request.method === 'GET' && url.searchParams.has('nt_session')) {
      const id = url.searchParams.get('nt_session');
      if (!state?.session || state.session !== id)
        return page(
          '<p>This booking does not belong to this browser.</p>',
          403,
        );
      const booking = await call('/api/v1/checkout-sessions/' + id);
      return page(
        booking.status === 'paid'
          ? '<h2>Payment verified</h2><p>' +
              escape(booking.admissions) +
              ' admissions purchased. ' +
              escape(booking.tickets_issued) +
              ' registered tickets.</p><p>Keep the tickets and group invitations shown on the Naija Tickets confirmation page.</p>'
          : '<h2>Booking update</h2><p>Verified server status: ' +
              escape(booking.status) +
              '. No fulfilment is based on return parameters.</p>',
      );
    }
    if (request.method === 'GET') {
      const events = c.eventId
        ? [{ id: c.eventId, title: 'Selected event' }]
        : await call('/api/v1/events', undefined, false);
      if (
        !Array.isArray(events) ||
        events.some(
          (event) => !uuid.test(event.id) || typeof event.title !== 'string',
        )
      )
        throw new ExampleError(
          'API_CATALOGUE',
          'Naija Tickets returned an unexpected catalogue. Check that NT_API_ORIGIN points to the current app.',
        );
      if (!events.length)
        throw new ExampleError(
          'NO_EVENTS',
          'No upcoming events are assigned to this key. Select a published event in Developers & Integrations and save website settings.',
        );
      state = {
        eventIds: events.map((event) => event.id),
        intent: randomUUID(),
        csrf: randomUUID(),
        exp: Date.now() + 1800000,
      };
      headers['Set-Cookie'] =
        'nt_example=' +
        seal(state, c.secret) +
        '; HttpOnly; SameSite=Lax; Path=' +
        c.path +
        '; Max-Age=1800' +
        (c.partner.startsWith('https:') ? '; Secure' : '');
      return page(
        '<p>' +
          escape(
            c.mode === 'test'
              ? 'Test purchase · No real charges'
              : 'Live purchase · Real payments',
          ) +
          '</p><p>This button calls Naija Tickets from this website’s server.</p><form method="POST"><label>Event<select name="event_id">' +
          events
            .map(
              (event) =>
                '<option value="' +
                escape(event.id) +
                '">' +
                escape(event.title) +
                '</option>',
            )
            .join('') +
          '</select></label><input type="hidden" name="csrf" value="' +
          escape(state.csrf) +
          '"><button>Buy Tickets</button></form>',
      );
    }
    if (request.method !== 'POST')
      return page('<p>Method not allowed.</p>', 405);
    if (
      request.headers.get('origin') !== c.partner ||
      !state ||
      !(request.headers.get('content-type') || '').startsWith(
        'application/x-www-form-urlencoded',
      )
    )
      return page('<p>Start again from this page.</p>', 403);
    const body = await smallForm(request);
    if (
      body.length > 256 ||
      new URLSearchParams(body).get('csrf') !== state.csrf
    )
      return page('<p>Invalid form.</p>', 403);
    const chosen = new URLSearchParams(body).get('event_id') || c.eventId;
    if (!uuid.test(chosen || '') || !state.eventIds?.includes(chosen))
      return page('<p>Select an event from this page.</p>', 400);
    const booking = await call('/api/v1/checkout-sessions', {
      event_id: chosen,
      return_url: c.partner + c.path,
      cancel_url: c.partner + c.path,
      external_reference: 'PARTNER-' + state.intent,
    });
    const target = new URL(booking.checkout_url);
    if (
      !uuid.test(booking.id) ||
      target.origin !== c.api ||
      target.pathname !== '/integrations/checkout/' + booking.id ||
      target.username ||
      target.password ||
      target.hash ||
      target.searchParams.size !== 1 ||
      !/^[a-f0-9]{64}$/.test(target.searchParams.get('access') || '')
    )
      throw new Error('Unsafe hosted URL');
    state.session = booking.id;
    headers['Set-Cookie'] =
      'nt_example=' +
      seal(state, c.secret) +
      '; HttpOnly; SameSite=Lax; Path=' +
      c.path +
      '; Max-Age=1800' +
      (c.partner.startsWith('https:') ? '; Secure' : '');
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: target.toString() },
    });
  } catch (cause) {
    const error =
      cause instanceof ExampleError
        ? cause
        : new ExampleError(
            'CHECKOUT_UNAVAILABLE',
            'Checkout is temporarily unavailable. Check the backend configuration and try again.',
          );
    return page(
      '<h2>Checkout needs attention</h2><p role="alert">' +
        escape(error.message) +
        '</p><p>Code: <code>' +
        escape(error.code) +
        '</code></p><p><a href="' +
        escape(env.NT_EXAMPLE_PATH || '/') +
        '">Try again</a></p>',
      503,
    );
  }
}
