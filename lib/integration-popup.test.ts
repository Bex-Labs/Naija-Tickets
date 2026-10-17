import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  createPopupPermit,
  verifyPopupPermit,
  popupUrl,
} from './integrations/checkout-popup.ts';
import { verifyPopupPayment } from './integrations/popup-payment.ts';
import middleware from '../middleware.ts';
const id = '10000000-0000-4000-8000-000000000001';
const keys = {
  activeVersion: 'v1',
  keys: { v1: 'fixture-isolated-popup-key-' + 'x'.repeat(50) },
};
const session = () => ({
  id,
  environment: 'test' as const,
  expires_at: new Date(Date.now() + 900000).toISOString(),
  signing_key_version: 'v1',
});
void test('popup permits bind the exact origin, session, mode, expiry and retained signing version', async () => {
  const value = session();
  const permit = await createPopupPermit(
    value,
    'https://partner.example',
    keys,
  );
  const result = await verifyPopupPermit(permit, id, keys);
  assert.equal(result?.parent, 'https://partner.example');
  assert.equal(result?.environment, 'test');
  const rotated = {
    activeVersion: 'v2',
    keys: { ...keys.keys, v2: 'y'.repeat(64) },
  };
  assert.ok(await verifyPopupPermit(permit, id, rotated));
  assert.equal(
    await verifyPopupPermit(permit, id, {
      ...rotated,
      keys: { v2: 'y'.repeat(64) },
    }),
    null,
  );
  assert.equal(
    await verifyPopupPermit(permit, id, keys, Date.parse(value.expires_at)),
    null,
  );
  assert.equal(
    await verifyPopupPermit(permit, id.replace(/1$/, '2'), keys),
    null,
  );
  for (const field of [
    'parent',
    'session',
    'environment',
    'expires',
    'version',
  ]) {
    const payload = JSON.parse(
      Buffer.from(permit.split('.')[0], 'base64url').toString(),
    );
    payload[field] =
      field === 'expires' ? Date.now() + 60000 : 'https://evil.example';
    const tampered =
      Buffer.from(JSON.stringify(payload)).toString('base64url') +
      '.' +
      permit.split('.')[1];
    assert.equal(await verifyPopupPermit(tampered, id, keys), null);
  }
  for (const parent of [
    'https://partner.example/path',
    'https://user:password@partner.example',
    'http://partner.example',
    'null',
    'https://*.example',
  ]) {
    await assert.rejects(createPopupPermit(value, parent, keys));
  }
  await assert.rejects(
    createPopupPermit(
      { ...value, environment: 'live' },
      'http://localhost:3001',
      keys,
    ),
  );
  assert.ok(await createPopupPermit(value, 'http://localhost:3001', keys));
});
void test('popup URLs keep the access capability out of requests and middleware only frames the signed ancestor', async () => {
  const access = 'a'.repeat(64);
  const url = new URL(
    await popupUrl(
      session(),
      access,
      'https://partner.example',
      'https://sandbox.example',
      keys,
    ),
  );
  assert.equal(url.searchParams.get('access'), null);
  assert.equal(url.hash, '#access=' + access);
  assert.ok(!url.search.includes(access));
  const previous = {
    enabled: process.env.INTEGRATIONS_POPUP_ENABLED,
    secret: process.env.INTEGRATIONS_SIGNING_SECRET,
    version: process.env.INTEGRATIONS_SIGNING_KEY_VERSION,
  };
  process.env.INTEGRATIONS_POPUP_ENABLED = 'true';
  process.env.INTEGRATIONS_SIGNING_SECRET = keys.keys.v1;
  process.env.INTEGRATIONS_SIGNING_KEY_VERSION = 'v1';
  try {
    const response = await middleware(new Request(url));
    assert.equal(response.headers.get('x-frame-options'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(
      response.headers.get('content-security-policy'),
      "frame-ancestors https://partner.example; base-uri 'self'; form-action 'self'",
    );
    url.searchParams.set('permit', 'invalid');
    const denied = await middleware(new Request(url));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('x-frame-options'), 'DENY');
    process.env.INTEGRATIONS_POPUP_ENABLED = 'false';
    assert.equal(
      (
        await middleware(
          new Request(
            await popupUrl(
              session(),
              access,
              'https://partner.example',
              'https://sandbox.example',
              keys,
            ),
          ),
        )
      ).status,
      403,
    );
  } finally {
    for (const [name, value] of Object.entries({
      INTEGRATIONS_POPUP_ENABLED: previous.enabled,
      INTEGRATIONS_SIGNING_SECRET: previous.secret,
      INTEGRATIONS_SIGNING_KEY_VERSION: previous.version,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
void test('popup payment verification trusts only the stored reference and matching provider amount, currency and mode', async () => {
  const expected = {
    reference: 'stored-payment-reference',
    amount: 4500000,
    currency: 'NGN',
    environment: 'test' as const,
  };
  const transaction = { ...expected, status: 'success', id: 5, domain: 'test' };
  let finalized = 0,
    delivered = 0,
    recorded = 0;
  const dependencies = {
    verify: async (reference: string) => {
      assert.equal(reference, expected.reference);
      return { data: transaction };
    },
    record: async () => {
      recorded++;
    },
    finalize: async (input: { reference: string }) => {
      assert.equal(input.reference, expected.reference);
      finalized++;
      return { outcome: 'success', order_id: id };
    },
    deliver: () => {
      delivered++;
    },
  };
  for (const changed of [
    { reference: 'attacker-supplied-reference' },
    { amount: 1 },
    { amount: NaN },
    { currency: 'USD' },
    { domain: 'live' },
    { domain: undefined },
  ]) {
    await assert.rejects(
      verifyPopupPayment(expected, {
        ...dependencies,
        verify: async () => ({ data: { ...transaction, ...changed } }),
      }),
    );
  }
  assert.equal(finalized, 0);
  assert.equal(delivered, 0);
  assert.equal(
    await verifyPopupPayment(expected, {
      ...dependencies,
      verify: async () => ({ data: { ...transaction, status: 'pending' } }),
    }),
    false,
  );
  assert.equal(recorded, 1);
  assert.equal(finalized, 0);
  assert.equal(await verifyPopupPayment(expected, dependencies), true);
  assert.equal(finalized, 1);
  assert.equal(delivered, 1);
  assert.equal(
    await verifyPopupPayment(expected, {
      ...dependencies,
      finalize: async () => ({ outcome: 'reservation_expired', order_id: id }),
    }),
    false,
  );
  assert.equal(delivered, 1);
});
function sdkFixture() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const elements: Record<string, unknown>[] = [];
  let focused = false;
  const element = (tag: string) => {
    const value = {
      tag,
      contentWindow: {},
      isConnected: true,
      children: [] as unknown[],
      style: {},
      setAttribute() {},
      append(...children: unknown[]) {
        this.children.push(...children);
      },
      remove() {
        this.isConnected = false;
      },
      focus() {},
      showModal() {},
      close() {},
      addEventListener(name: string, fn: unknown) {
        (this as Record<string, unknown>)[name] = fn;
      },
    };
    elements.push(value);
    return value;
  };
  const window: Record<string, unknown> = {
    addEventListener: (
      name: string,
      fn: (event: Record<string, unknown>) => void,
    ) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const document = {
    currentScript: {
      src: 'https://sandbox.example/integrations/checkout-v1.js',
    },
    head: element('head'),
    body: element('body'),
    documentElement: { style: { overflow: 'auto' } },
    activeElement: {
      isConnected: true,
      focus() {
        focused = true;
      },
    },
    createElement: element,
  };
  runInNewContext(
    readFileSync(
      new URL('../public/integrations/checkout-v1.js', import.meta.url),
      'utf8',
    ),
    {
      window,
      document,
      location: { origin: 'https://partner.example' },
      URL,
      Object,
      Error,
    },
  );
  return {
    sdk: window.NaijaTicketsCheckout as {
      open(input: Record<string, unknown>): { close(): void };
    },
    elements,
    listeners,
    document,
    focused: () => focused,
  };
}
void test('SDK rejects unsafe URLs and accepts completion only from the exact frame, origin, session and channel', async () => {
  const f = sdkFixture();
  for (const popup of [
    'https://evil.example/embed/checkout/' + id,
    'javascript:alert(1)',
    'https://sandbox.example/events/' + id,
  ])
    assert.throws(() => f.sdk.open({ popupUrl: popup }));
  const url = await popupUrl(
    session(),
    'a'.repeat(64),
    'https://partner.example',
    'https://sandbox.example',
    keys,
  );
  let completed = 0,
    closed = 0;
  f.sdk.open({
    popupUrl: url,
    onComplete: () => completed++,
    onClose: () => closed++,
  });
  assert.throws(() => f.sdk.open({ popupUrl: url }));
  const frame = f.elements.find((e) => e.tag === 'iframe')!;
  const data = {
    type: 'naija.checkout.complete',
    sessionId: id,
    channel: new URL(url).searchParams.get('permit'),
  };
  const receive = f.listeners.get('message')!;
  receive({
    origin: 'https://evil.example',
    source: frame.contentWindow,
    data,
  });
  receive({ origin: 'https://sandbox.example', source: {}, data });
  receive({
    origin: 'https://sandbox.example',
    source: frame.contentWindow,
    data: { ...data, sessionId: 'other' },
  });
  receive({
    origin: 'https://sandbox.example',
    source: frame.contentWindow,
    data: { ...data, channel: 'forged' },
  });
  assert.equal(completed, 0);
  receive({
    origin: 'https://sandbox.example',
    source: frame.contentWindow,
    data,
  });
  assert.equal(completed, 1);
  assert.equal(closed, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.document.documentElement.style.overflow, 'auto');
  assert.equal(f.focused(), true);
  const handle = f.sdk.open({ popupUrl: url, onClose: () => closed++ });
  handle.close();
  handle.close();
  assert.equal(closed, 1);
});
