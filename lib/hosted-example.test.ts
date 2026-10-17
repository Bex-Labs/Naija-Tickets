import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHostedExample } from '../examples/hosted-checkout/handler.mjs';
import { parseCheckoutIntent } from './integrations/checkout-sessions.ts';
void test('optional checkout metadata is bounded, does not impersonate customer accounts and preserves explicit event identity', () => {
  const id = '10000000-0000-4000-8000-000000000001',
    body = { event_id: id, return_url: 'https://partner.example/complete' };
  const value = parseCheckoutIntent(
    {
      ...body,
      customer: { email: 'buyer@example.test' },
      external_reference: 'TGIF-123',
    },
    { environment: 'live' },
  );
  assert.deepEqual(value.items, []);
  assert.deepEqual(value.customer, { email: 'buyer@example.test' });
  for (const invalid of [
    { ...body, customer: { id } },
    { ...body, customer: { email: 'not-an-email' } },
    { ...body, customer: { phone: 'short' } },
    { ...body, external_reference: 'secret\nvalue' },
    { ...body, items: [{ ticket_type_id: id, quantity: 1, price: 0 }] },
  ])
    assert.throws(() => parseCheckoutIntent(invalid, { environment: 'live' }));
});
void test('runnable Node/Next partner example protects keys, CSRF, redirects and browser-owned server verification', async () => {
  const id = '10000000-0000-4000-8000-000000000001',
    env = {
      NODE_ENV: 'test' as const,
    NT_API_ORIGIN: 'https://sandbox.example',
      NT_PARTNER_ORIGIN: 'https://partner.example',
      NT_MODE: 'test',
      NT_API_KEY: 'nt_test_' + 'a'.repeat(32) + '_' + 'b'.repeat(43),
      NT_EXAMPLE_COOKIE_SECRET: 'fixture-only-cookie-' + 'x'.repeat(50),
      NT_EVENT_ID: id,
    };
  let calls = 0,
    status = 'pending';
  const upstream: typeof fetch = async (_url, options) => {
    calls++;
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer ' + env.NT_API_KEY,
    );
    return Response.json({
      data: {
        id,
        environment: 'test',
        status,
        admissions: 5,
        tickets_issued: 1,
        checkout_url:
          'https://sandbox.example/integrations/checkout/' +
          id +
          '?access=' +
          'c'.repeat(64),
      },
    });
  };
  const first = await handleHostedExample(
    new Request('https://partner.example/'),
    env,
    upstream,
  );
  const html = await first.text(),
    cookie = first.headers.get('set-cookie')!.split(';')[0],
    csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
  assert.ok(!html.includes(env.NT_API_KEY));
  assert.ok(!html.includes(env.NT_EXAMPLE_COOKIE_SECRET));
  const post = (origin = 'https://partner.example', token = csrf) =>
    new Request('https://partner.example/', {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrf: token }),
    });
  assert.equal(
    (await handleHostedExample(post('https://evil.example'), env, upstream))
      .status,
    403,
  );
  assert.equal(
    (
      await handleHostedExample(
        post('https://partner.example', 'forged'),
        env,
        upstream,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const checkout = await handleHostedExample(post(), env, upstream);
  assert.equal(checkout.status, 303);
  assert.equal(calls, 1);
  const owner = checkout.headers.get('set-cookie')!.split(';')[0];
  const result = () =>
    new Request(
      'https://partner.example/?nt_session=' + id + '&nt_status=paid',
      { headers: { Cookie: owner } },
    );
  assert.ok(
    !(
      await (await handleHostedExample(result(), env, upstream)).text()
    ).includes('<h2>Payment verified'),
  );
  status = 'paid';
  assert.ok(
    (
      await (await handleHostedExample(result(), env, upstream)).text()
    ).includes('<h2>Payment verified'),
  );
  const outsider = new Request('https://partner.example/?nt_session=' + id, {
    headers: { Cookie: cookie },
  });
  assert.equal(
    (await handleHostedExample(outsider, env, upstream)).status,
    403,
  );
});
