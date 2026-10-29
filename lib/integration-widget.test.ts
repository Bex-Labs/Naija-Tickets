import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import {
  widgetPageHandler,
  widgetCheckoutHandler,
  widgetHeaders,
  renderWidget,
} from './integrations/widget-html.ts';
import { widgetReadHandler } from './integrations/widget-api.ts';
import {
  parseWidgetSelection,
  projectWidgetSnapshot,
  type WidgetDependencies,
  type WidgetSnapshot,
} from './integrations/widget.ts';
import {
  signWidgetProof,
  verifyWidgetProof,
} from './integrations/widget-proof.ts';
import { widgetSnippet } from './integrations/widget-snippet.ts';
import { IntegrationError } from './integrations/errors.ts';
import type { StoredCheckoutSession } from './integrations/checkout-sessions.ts';
const event = '30000000-0000-4000-8000-000000000001',
  tier = '40000000-0000-4000-8000-000000000001';
const widget = 'nt_widget_' + 'a'.repeat(32),
  parentOrigin = 'https://partner.example',
  apiOrigin = 'https://tickets.example';
const signing = {
  activeVersion: 'v1',
  keys: { v1: 'widget-unit-fixture-' + 'x'.repeat(50) },
};
function selectionUrl() {
  const url = new URL('/embed/events/' + event, apiOrigin);
  for (const [name, value] of Object.entries({
    widget,
    environment: 'live',
    parent_origin: parentOrigin,
    return_url: parentOrigin + '/done',
    channel: 'a'.repeat(32),
  }))
    url.searchParams.set(name, value);
  return url;
}
const selection = () => parseWidgetSelection(selectionUrl(), event);
const raw: WidgetSnapshot = {
  actor: {
    integrationId: crypto.randomUUID(),
    organiserId: crypto.randomUUID(),
    widgetConfigId: crypto.randomUUID(),
    revision: 1,
    checkoutEnabled: true,
  },
  event: {
    id: event,
    title: 'Lagos Night',
    slug: 'lagos-night',
    description: 'Public description',
    image_url: null,
    venue_name: 'Hall',
    address: 'Waterfront',
    city: 'Lagos',
    state: 'Lagos',
    starts_at: '2027-01-01T18:00:00Z',
    ends_at: '2027-01-01T23:00:00Z',
    timezone: 'Africa/Lagos',
    sales_start_at: null,
    sales_end_at: null,
    organiser: {
      id: crypto.randomUUID(),
      name: 'Demo organiser',
      verified: true,
    },
    category: { id: crypto.randomUUID(), name: 'Concert', slug: 'concert' },
  },
  tickets: [
    {
      ticket: {
        id: tier,
        event_id: event,
        name: 'Squad Pass',
        description: 'Bring your friends',
        price_kobo: '4500000',
        standard_price_kobo: '4500000',
        price_kind: 'standard',
        early_bird_price_kobo: null,
        early_bird_ends_at: null,
        admissions_per_ticket: 5,
        min_packages_per_order: 1,
        max_packages_per_order: 6,
        sales_start_at: null,
        sales_end_at: null,
        sale_status: 'open',
      },
      max_packages: 6,
    },
  ],
};
function dependencies() {
  let creates = 0;
  const logs: Record<string, string | number | null>[] = [];
  const deps: WidgetDependencies = {
    api: {
      limit: async () => ({ allowed: true, retryAfter: 60 }),
      log: (item) => logs.push(item),
    },
    requireConfiguration: async () => {},
    origin: () => apiOrigin,
    signingKeys: () => signing,
    read: async (input) => {
      if (input.parentOrigin !== parentOrigin)
        throw new IntegrationError(404, 'NOT_FOUND', 'Widget unavailable.');
      return structuredClone(raw);
    },
    create: async (_s, input) => {
      creates++;
      return {
        ...input.session,
        capability_hash: input.accessHash,
      } as StoredCheckoutSession;
    },
  };
  return { deps, logs, creates: () => creates };
}
const proof = () =>
  signWidgetProof(
    { ...selection(), configurationId: raw.actor.widgetConfigId, revision: 1 },
    signing,
  );
function form(token = proof(), quantity = '2', origin = apiOrigin) {
  return new Request(apiOrigin + '/integrations/widget-checkout', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      proof: token,
      ['quantity_' + tier]: quantity,
      promo_code: '',
    }),
  });
}
void test('widget query and snippets accept only public identifiers and exact mode/origin/return paths', () => {
  assert.equal(selection().parentOrigin, parentOrigin);
  for (const [name, value] of [
    ['widget', 'nt_live_secret'],
    ['parent_origin', 'https://*.example'],
    ['parent_origin', 'http://partner.example'],
    ['return_url', 'https://evil.example/done'],
    ['return_url', parentOrigin + '/done?secret=abc'],
    ['channel', '<script>'],
    ['environment', 'staging'],
  ]) {
    const url = selectionUrl();
    url.searchParams.set(name, value);
    assert.throws(() => parseWidgetSelection(url, event));
  }
  const extra = selectionUrl();
  extra.searchParams.append('widget', widget);
  assert.throws(() => parseWidgetSelection(extra, event));
  extra.searchParams.set('authorization', 'secret');
  assert.throws(() => parseWidgetSelection(extra, event));
  const local = selectionUrl();
  local.searchParams.set('environment', 'test');
  local.searchParams.set('parent_origin', 'http://localhost:3015');
  local.searchParams.delete('return_url');
  assert.equal(
    parseWidgetSelection(local, event).parentOrigin,
    'http://localhost:3015',
  );
  const snippet = widgetSnippet(apiOrigin, selection());
  assert.ok(snippet.includes(widget));
  assert.ok(!snippet.includes('nt_test_'));
  assert.ok(!snippet.includes('secret'));
});
void test('short-lived widget proofs bind selection origin, revision, event and purpose with bounded key rotation', () => {
  const token = proof(),
    value = verifyWidgetProof(token, signing);
  assert.equal(value.parentOrigin, parentOrigin);
  assert.equal(value.revision, 1);
  assert.throws(() => verifyWidgetProof(token, signing, Date.now() + 301000));
  assert.throws(() => verifyWidgetProof(token, signing, Date.now() - 301000));
  const [payload, signature] = token.split('.');
  for (const change of [
    { parentOrigin: 'https://evil.example' },
    { eventId: crypto.randomUUID() },
    { revision: 2 },
  ]) {
    const modified = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        ...change,
      }),
    ).toString('base64url');
    assert.throws(() => verifyWidgetProof(modified + '.' + signature, signing));
  }
  assert.ok(
    verifyWidgetProof(token, {
      activeVersion: 'v2',
      keys: { ...signing.keys, v2: 'new-fixture-' + 'y'.repeat(50) },
    }),
  );
  assert.throws(() =>
    verifyWidgetProof(token, {
      activeVersion: 'v2',
      keys: { v2: 'new-fixture-' + 'y'.repeat(50) },
    }),
  );
});
void test('standalone frame escapes event/ticket HTML, keeps private routes frame-denied and works without browser storage', async () => {
  const { deps } = dependencies(),
    response = await widgetPageHandler(
      deps,
      event,
    )(new Request(selectionUrl()));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin');
  assert.match(
    response.headers.get('Content-Security-Policy')!,
    /frame-ancestors https:\/\/partner.example/,
  );
  const html = await response.text();
  assert.ok(!html.includes(signing.keys.v1));
  assert.match(html, /target="naija_ticket_checkout"/);
  const injected = projectWidgetSnapshot(
    {
      ...raw,
      event: {
        ...(raw.event as object),
        title: '<img src=x onerror=alert(1)>',
      },
      tickets: [
        {
          ...raw.tickets[0],
          ticket: {
            ...(raw.tickets[0].ticket as object),
            name: '"><script>alert(1)</script>',
          },
        },
      ],
    },
    selection(),
  );
  const escaped = renderWidget(injected, selection(), proof(), apiOrigin);
  assert.ok(!escaped.includes('<script>alert'));
  assert.ok(!escaped.includes('<img src=x'));
  assert.ok(escaped.includes('&lt;img'));
  assert.equal(widgetHeaders()['X-Frame-Options'], 'DENY');
  assert.equal(widgetHeaders()['Referrer-Policy'], 'no-referrer');
  assert.ok(
    widgetHeaders()['Content-Security-Policy'].includes(
      "frame-ancestors 'none'",
    ),
  );
  const readOnly = {
    ...deps,
    requireConfiguration: async (_mode: 'test' | 'live', checkout: boolean) => {
      if (checkout) throw new Error('disabled');
    },
  };
  const disabled = await widgetPageHandler(
    readOnly,
    event,
  )(new Request(selectionUrl()));
  assert.match(await disabled.text(), /Online checkout is not available/);
});
void test('public widget CORS is exact, credentials/custom preflights are rejected, and limits fail closed', async () => {
  const { deps } = dependencies(),
    handle = widgetReadHandler(deps, widget, event),
    url =
      apiOrigin +
      '/api/integrations/widgets/' +
      widget +
      '/events/' +
      event +
      '?environment=live';
  const response = await handle(
    new Request(url, { headers: { Origin: parentOrigin } }),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    parentOrigin,
  );
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  assert.ok(response.headers.get('X-Request-ID'));
  assert.ok(!JSON.stringify(await response.json()).includes('widgetConfigId'));
  for (const headers of [
    {},
    { Origin: 'null' },
    { Origin: 'https://evil.example' },
    { Origin: parentOrigin, Authorization: 'Bearer nt_live_secret' },
  ] as Record<string, string>[]) {
    const denied = await handle(new Request(url, { headers }));
    assert.ok([400, 403, 404].includes(denied.status));
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
  const options = await handle(
    new Request(url, {
      method: 'OPTIONS',
      headers: { Origin: parentOrigin, 'Access-Control-Request-Method': 'GET' },
    }),
  );
  assert.equal(options.status, 204);
  const preflight = await handle(
    new Request(url, {
      method: 'OPTIONS',
      headers: {
        Origin: parentOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    }),
  );
  assert.equal(preflight.status, 405);
  const limited = widgetReadHandler(
    {
      ...deps,
      api: { limit: async () => ({ allowed: false, retryAfter: 60 }) },
    },
    widget,
    event,
  );
  const blocked = await limited(
    new Request(url, { headers: { Origin: parentOrigin } }),
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
});
void test('handoff rejects forged/expired/cross-origin/price inputs and sends capabilities only as a top-level redirect', async () => {
  const { deps, logs, creates } = dependencies(),
    handle = widgetCheckoutHandler(deps);
  const response = await handle(form());
  assert.equal(response.status, 303);
  assert.match(
    response.headers.get('Location')!,
    /\/integrations\/checkout\/.+\?access=[a-f0-9]{64}$/,
  );
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(await response.text(), '');
  assert.equal(creates(), 1);
  for (const request of [
    form('invalid'),
    form(proof(), '21'),
    form(proof(), '2', 'https://evil.example'),
    new Request(apiOrigin + '/integrations/widget-checkout', {
      method: 'POST',
      headers: { Origin: apiOrigin, 'Content-Type': 'application/json' },
      body: '{}',
    }),
  ])
    assert.ok((await handle(request)).status >= 400);
  const extra = new URLSearchParams({
    proof: proof(),
    ['quantity_' + tier]: '1',
    price_kobo: '1',
  });
  assert.equal(
    (
      await handle(
        new Request(apiOrigin + '/integrations/widget-checkout', {
          method: 'POST',
          headers: {
            Origin: apiOrigin,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: extra,
        }),
      )
    ).status,
    400,
  );
  assert.equal(creates(), 1);
  const log = JSON.stringify(logs);
  assert.ok(!log.includes('access='));
  assert.ok(!log.includes('proof'));
  assert.ok(!log.includes(signing.keys.v1));
});
void test('loader isolates multiple frames and accepts only bounded resize messages from the expected origin/window/channel', () => {
  const source = readFileSync(
    new URL('../public/integrations/widget-v1.js', import.meta.url),
    'utf8',
  );
  const nodes = Array.from({ length: 2 }, () => ({
    attrs: {
      'data-naija-widget': widget,
      'data-event': event,
      'data-environment': 'live',
    } as Record<string, string>,
    children: [] as Record<string, unknown>[],
    getAttribute(name: string) {
      return this.attrs[name] || null;
    },
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    },
    appendChild(value: Record<string, unknown>) {
      this.children.push(value);
    },
  }));
  const listeners: Record<string, (event: Record<string, unknown>) => void> =
    {};
  const window = {
    addEventListener: (name: string, fn: (typeof listeners)[string]) => {
      listeners[name] = fn;
    },
  };
  const document = {
    currentScript: { src: apiOrigin + '/integrations/widget-v1.js' },
    readyState: 'complete',
    querySelectorAll: () => nodes,
    createElement: () => ({
      style: {} as Record<string, string>,
      contentWindow: {},
      setAttribute() {},
    }),
  };
  const context = {
    window,
    document,
    URL,
    location: {
      origin: parentOrigin,
      pathname: '/events',
      search: '?private=do-not-forward',
    },
    crypto: webcrypto,
    Uint8Array,
  };
  runInNewContext(source, context);
  const frame = nodes[0].children[0] as {
    src: string;
    style: Record<string, string>;
    contentWindow: object;
  };
  const frame2 = nodes[1].children[0] as typeof frame,
    url = new URL(frame.src),
    channel = url.searchParams.get('channel');
  assert.equal(new URL(url.searchParams.get('return_url')!).search, '');
  assert.equal(nodes[0].children.length, 2);
  assert.notEqual(channel, new URL(frame2.src).searchParams.get('channel'));
  const dispatch = (
    origin = apiOrigin,
    source = frame.contentWindow,
    height = 700,
    ch = channel,
  ) =>
    listeners.message({
      origin,
      source,
      data: { type: 'naija:widget:resize:v1', channel: ch, height },
    });
  dispatch();
  assert.equal(frame.style.height, '700px');
  dispatch('https://evil.example', frame.contentWindow, 900);
  dispatch(apiOrigin, {}, 900);
  dispatch(apiOrigin, frame.contentWindow, 900, 'wrong');
  dispatch(apiOrigin, frame.contentWindow, 99999);
  dispatch(apiOrigin, frame.contentWindow, 700.1);
  assert.equal(frame.style.height, '700px');
  assert.equal(frame2.style.height, '640px');
  runInNewContext(source, context);
  assert.equal(nodes[0].children.length, 2);
});
void test('frame client shows blank initial totals, counts admissions and uses no third-party cookies/storage', () => {
  const source = readFileSync(
    new URL('../public/integrations/widget-frame-v1.js', import.meta.url),
    'utf8',
  );
  const messages: { data: { height: number }; target: string }[] = [],
    events: Record<string, () => void> = {};
  const output = { textContent: '' },
    admissions = { textContent: '' },
    button = { disabled: false };
  const select = {
    value: '0',
    getAttribute: (name: string) => (name === 'data-price' ? '4500000' : '5'),
  };
  const form = {
    querySelectorAll: () => [select],
    querySelector: () => button,
    addEventListener: (name: string, fn: () => void) => {
      events[name] = fn;
    },
  };
  const root = {
    querySelector: () => form,
    getAttribute: (name: string) =>
      name === 'data-channel' ? 'a'.repeat(32) : parentOrigin,
    getBoundingClientRect: () => ({ height: 650 }),
  };
  const document = {
    querySelector: () => root,
    getElementById: (name: string) =>
      name === 'subtotal' ? output : admissions,
  };
  Object.defineProperty(document, 'cookie', {
    get() {
      throw new Error('must not read cookies');
    },
  });
  const window = { addEventListener() {} };
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new Error('must not use storage');
    },
  });
  const parent = {
    postMessage: (data: { height: number }, target: string) =>
      messages.push({ data, target }),
  };
  runInNewContext(source, {
    document,
    window,
    parent,
    ResizeObserver: class {
      observe() {}
    },
    Intl,
  });
  assert.equal(output.textContent, 'Select tickets');
  assert.ok(button.disabled);
  assert.equal(messages[0].target, parentOrigin);
  select.value = '2';
  events.change();
  assert.ok(!button.disabled);
  assert.match(output.textContent, /90,000/);
  assert.match(admissions.textContent, /10 admissions/);
});
