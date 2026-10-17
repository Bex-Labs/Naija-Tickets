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
function config(env) {
  const api = new URL(env.NT_API_ORIGIN),
    partner = new URL(env.NT_PARTNER_ORIGIN),
    path = env.NT_EXAMPLE_PATH || '/';
  const mode = env.NT_MODE || 'test',
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
      throw new Error('Use exact HTTPS origins; localhost HTTP is test-only.');
  if (
    !['test', 'live'].includes(mode) ||
    !new RegExp('^nt_' + mode + '_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$').test(
      key || '',
    ) ||
    !uuid.test(env.NT_EVENT_ID || '') ||
    !secret ||
    secret.length < 43 ||
    secret === key ||
    !/^\/[A-Za-z0-9_/-]*$/.test(path) ||
    path.startsWith('//')
  )
    throw new Error(
      'Configure the example with an assigned event, matching mode/key and dedicated cookie secret.',
    );
  return { api: api.origin, partner: partner.origin, path, mode, key, secret };
}
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
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
  const page = (text, status = 200) =>
    new Response(
      '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Abuja TGIF partner example</title><main><h1>Abuja TGIF</h1>' +
        text +
        '</main>',
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
    const call = async (path, body) => {
      const response = await fetchImpl(c.api + path, {
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
      const result = await response.json();
      if (!response.ok || !result.data || result.data.environment !== c.mode)
        throw new Error('Upstream checkout unavailable');
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
      state = {
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
          escape(c.mode) +
          ' mode. Choose tickets and complete payment on Naija Tickets.</p><form method="POST"><input type="hidden" name="csrf" value="' +
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
    const booking = await call('/api/v1/checkout-sessions', {
      event_id: env.NT_EVENT_ID,
      return_url: c.partner + c.path,
      cancel_url: c.partner + c.path,
      external_reference: 'TGIF-' + state.intent,
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
  } catch {
    return page(
      '<p>Checkout is temporarily unavailable. Check the server configuration without sharing keys.</p>',
      503,
    );
  }
}
