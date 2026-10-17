import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { publicIntegrationSpec } from './integrations/public-spec.ts';
import {
  assemblePublicOpenApi,
  type OpenApiDocument,
} from './integrations/openapi.ts';
import {
  integrationReadiness,
  ACCEPTANCE_GATES,
} from './integrations/readiness.ts';
import { developerGuides } from './integrations/developer-guides.ts';
import { parseWidgetSelection } from './integrations/widget.ts';
import { widgetSnippet } from './integrations/widget-snippet.ts';
import {
  derivePasswordHash,
  deriveLegacyAdminHash,
  verifyAdminCredentials,
  createAdminSessionToken,
  adminSessionMatchesCredential,
  getAdminSessionAccountId,
} from './admin-auth.ts';
import { parseAdminSignIn, limitAdminSignIn } from './admin-login.ts';
import {
  adminIntegrationsHandler,
  projectAdminOverview,
  projectAdminActivity,
  type IntegrationOversightDependencies,
} from './integrations/admin.ts';
const id = '10000000-0000-4000-8000-000000000001';
const application = {
  id,
  name: 'Fictional partner',
  organiserId: id,
  organiserName: 'Fictional organiser',
  status: 'active',
  suspendedAt: null,
  suspensionReason: null,
  createdAt: '2026-10-16T00:00:00Z',
  activeKeys: 1,
  assignedEvents: 1,
  requests24h: 2,
  errors24h: 1,
  pendingDeliveries: 2,
  exhaustedDeliveries: 1,
};
const overview = {
  applications: [application],
  totals: {
    applications: 1,
    suspended: 0,
    requests24h: 2,
    errors24h: 1,
    exhaustedDeliveries: 1,
  },
  resourceMode: 'test',
  asOf: '2026-10-16T00:00:00Z',
};
void test('public OpenAPI has implemented routes, unique IDs, resolved namespaced references and no private control surface', () => {
  const document = publicIntegrationSpec;
  assert.equal(Object.keys(document.paths).length, 20);
  const operationIds = new Set();
  for (const [path, value] of Object.entries(document.paths)) {
    assert.ok(
      !path.includes('/admin') &&
        !path.includes('/organiser') &&
        !path.includes('/internal'),
    );
    const source =
      'app' + path.replaceAll(/\{([^}]+)\}/g, '[$1]') + '/route.ts';
    assert.ok(existsSync(source), source);
    for (const method of ['get', 'post', 'options']) {
      const op = (value as Record<string, { operationId: string }>)[method];
      if (!op) continue;
      assert.ok(!operationIds.has(op.operationId));
      operationIds.add(op.operationId);
    }
  }
  const check = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(check);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [name, item] of Object.entries(value)) {
      if (name === '$ref') {
        const parts = String(item).split('/').slice(1);
        let target: unknown = document;
        for (const part of parts)
          target = (target as Record<string, unknown>)[part];
        assert.ok(target, item as string);
      }
      if (name === 'security')
        for (const group of item as Record<string, unknown>[])
          for (const scheme of Object.keys(group))
            assert.ok(document.components.securitySchemes[scheme]);
      check(item);
    }
  };
  check(document);
  const text = JSON.stringify(document);
  assert.ok(text.includes('attendees:contact'));
  assert.ok(text.includes('advanced_operations'));
  assert.ok(text.includes('naija-webhook-signature'));
  assert.equal(text.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  const source = JSON.parse(
    readFileSync('docs/integrations-phase3-openapi.json', 'utf8'),
  ) as OpenApiDocument;
  assert.throws(
    () =>
      assemblePublicOpenApi([
        { phase: 3, document: source },
        { phase: 3, document: source },
      ]),
    /Duplicate/,
  );
  assert.ok(
    Object.keys(developerGuides).every(
      (name) => !['__proto__', 'constructor'].includes(name),
    ),
  );
});
void test('readiness distinguishes disabled/pending/configuration failures and never prints supplied secret values', () => {
  const secret = 'fixture-server-secret-' + 'x'.repeat(50);
  const env = {
    APP_URL: 'https://sandbox.example',
    NEXT_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
    SUPABASE_SERVICE_ROLE_KEY: secret,
    INTEGRATIONS_RESOURCE_MODE: 'test',
    INTEGRATIONS_SANDBOX_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
    INTEGRATIONS_LIVE_PROJECT_REF: 'bbbbbbbbbbbbbbbbbbbb',
    PAYSTACK_SECRET_KEY: 'sk_test_' + secret,
  };
  const disabled = integrationReadiness(env);
  assert.equal(disabled.configurationValid, true);
  assert.equal(disabled.ready, false);
  assert.ok(disabled.checks.some((c) => c.state === 'disabled'));
  assert.ok(disabled.checks.some((c) => c.state === 'pending'));
  assert.equal(JSON.stringify(disabled).includes(secret), false);
  const unsafe = integrationReadiness({
    ...env,
    INTEGRATIONS_SANDBOX_PROJECT_REF: env.INTEGRATIONS_LIVE_PROJECT_REF,
  });
  assert.equal(unsafe.configurationValid, false);
  const reused = integrationReadiness({
    ...env,
    INTEGRATIONS_CHECKOUT_ENABLED: 'true',
    INTEGRATIONS_SIGNING_SECRET: secret,
  });
  assert.equal(
    reused.checks.find((c) => c.id === 'checkout_signing')?.state,
    'fail',
  );
  assert.equal(
    integrationReadiness({
      ...env,
      APP_URL: 'https://naija-tickets.vercel.app',
    }).configurationValid,
    false,
  );
  const fakeEvidence = Object.fromEntries(
    ACCEPTANCE_GATES.map((k) => [k, { status: 'passed' }]),
  );
  assert.ok(
    integrationReadiness(env, fakeEvidence)
      .checks.filter((c) =>
        ACCEPTANCE_GATES.includes(c.id as (typeof ACCEPTANCE_GATES)[number]),
      )
      .every((c) => c.state === 'pending'),
  );
});
void test('admin hashes support legacy verification, bounded slow hashing and credential-bound signed session invalidation', async () => {
  const previous = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'fixture-admin-session-' + 's'.repeat(50);
  try {
    const salt = 'fixture-salt-0123456789abcdef',
      password = 'Fictional-password-123';
    const hash = await derivePasswordHash(password, salt);
    assert.match(hash, /^scrypt-v1:[a-f0-9]{128}$/);
    const credentials = {
      id: 'primary',
      username: 'private-admin',
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: '2026-10-16',
    };
    assert.equal(
      await verifyAdminCredentials('private-admin', password, credentials),
      true,
    );
    assert.equal(
      await verifyAdminCredentials('private-admin', 'wrong', credentials),
      false,
    );
    const legacy = await deriveLegacyAdminHash(password, salt);
    assert.match(legacy, /^[a-f0-9]{64}$/);
    assert.equal(
      await verifyAdminCredentials('private-admin', password, {
        ...credentials,
        passwordHash: legacy,
      }),
      true,
    );
    assert.equal(
      await verifyAdminCredentials('private-admin', password, {
        ...credentials,
        passwordHash: 'scrypt-v1:bad',
      }),
      false,
    );
    await assert.rejects(() => derivePasswordHash('x'.repeat(1025), salt));
    const token = await createAdminSessionToken('primary', hash);
    assert.equal(await getAdminSessionAccountId(token), 'primary');
    assert.equal(await adminSessionMatchesCredential(token, hash), true);
    assert.equal(await adminSessionMatchesCredential(token, legacy), false);
    assert.equal(await adminSessionMatchesCredential(token + 'x', hash), false);
    assert.equal(
      await adminSessionMatchesCredential(
        await createAdminSessionToken('primary'),
        hash,
      ),
      false,
    );
    process.env.ADMIN_SESSION_SECRET = 'different-fixture-' + 's'.repeat(50);
    assert.equal(await getAdminSessionAccountId(token), null);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previous;
  }
});
void test('admin sign-in validates bounded fields and applies shared global/account/trusted-IP limits without raw identifiers', async () => {
  assert.throws(() =>
    parseAdminSignIn({ username: 'admin', password: 'x', role: 'admin' }),
  );
  assert.throws(() =>
    parseAdminSignIn({ username: 'admin', password: 'x'.repeat(1025) }),
  );
  assert.deepEqual(parseAdminSignIn({ username: 'admin', password: 'valid' }), {
    username: 'admin',
    password: 'valid',
  });
  const buckets: string[] = [];
  await limitAdminSignIn(
    new Request('https://tickets.example/'),
    'private-login',
    {
      limit: async (bucket) => {
        buckets.push(bucket);
        return { allowed: true, retryAfter: 60 };
      },
      trustedIp: () => '127.0.0.1',
    },
  );
  assert.equal(buckets.length, 3);
  assert.ok(!buckets.join().includes('private-login'));
  assert.ok(!buckets.join().includes('127.0.0.1'));
  await assert.rejects(() =>
    limitAdminSignIn(new Request('https://tickets.example/'), 'private-login', {
      limit: async () => ({ allowed: false, retryAfter: 20 }),
    }),
  );
});
void test('private oversight authenticates before reads; keys, cross-origin writes and wrong passwords cannot suspend an application', async () => {
  let signedIn = false,
    passwordOk = false,
    writes = 0,
    reads = 0;
  const deps: IntegrationOversightDependencies = {
    authenticate: async () =>
      signedIn ? { id: 'primary', username: 'private-admin' } : null,
    verifyPassword: async () => passwordOk,
    limit: async () => {},
    overview: async () => {
      reads++;
      return overview;
    },
    activity: async () => ({ requests: [], audit: [] }),
    decide: async () => {
      writes++;
    },
  };
  const collection = adminIntegrationsHandler(deps),
    detail = adminIntegrationsHandler(deps, id);
  const send = (body: unknown, origin = 'https://tickets.example') =>
    detail(
      new Request('https://tickets.example/api/admin/integrations/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await collection(new Request('https://tickets.example/'))).status,
    401,
  );
  assert.equal(reads, 0);
  signedIn = true;
  assert.equal(
    (
      await collection(
        new Request('https://tickets.example/', {
          headers: { Authorization: 'Bearer nt_test_fake' },
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (await collection(new Request('https://tickets.example/'))).status,
    200,
  );
  assert.equal(reads, 1);
  assert.equal(
    (
      await send(
        { action: 'suspend', reason: 'Abuse review', password: 'test' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send({
        action: 'suspend',
        reason: 'Abuse review',
        password: 'test',
      })
    ).status,
    403,
  );
  passwordOk = true;
  assert.equal(
    (
      await send({
        action: 'suspend',
        reason: 'Abuse review',
        password: 'test',
        secret: 'bad',
      })
    ).status,
    400,
  );
  assert.equal((await send(null)).status, 400);
  const result = await send({
    action: 'suspend',
    reason: 'Abuse review',
    password: 'test',
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(writes, 1);
  const projected = projectAdminOverview({
    ...overview,
    credentials: 'PRIVATE',
    applications: [
      {
        ...application,
        credential_digest: 'PRIVATE',
        encrypted_secret: 'PRIVATE',
      },
    ],
  });
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
  const activity = projectAdminActivity({
    requests: [],
    audit: [
      {
        id: '1',
        action: 'integration.created',
        createdAt: '2026-10-16',
        actorId: id,
        adminActorId: null,
        environment: null,
        keyId: null,
        endpointId: null,
        outcome: null,
        metadata: { secret: 'PRIVATE' },
      },
    ],
  });
  assert.ok(!JSON.stringify(activity).includes('PRIVATE'));
});
void test('widget themes accept only declared appearance tokens and keep snippets free of arbitrary CSS or active content', () => {
  const url = new URL('https://tickets.example/embed/events/' + id);
  for (const [k, v] of Object.entries({
    widget: 'nt_widget_' + 'a'.repeat(32),
    environment: 'test',
    parent_origin: 'http://localhost:3001',
    channel: 'a'.repeat(32),
    appearance: 'dark',
    accent: 'blue',
    button: 'square',
  }))
    url.searchParams.set(k, v);
  const selected = parseWidgetSelection(url, id);
  assert.equal(selected.appearance, 'dark');
  assert.equal(selected.accent, 'blue');
  assert.equal(selected.button, 'square');
  const snippet = widgetSnippet('https://sandbox.example', selected);
  assert.ok(snippet.includes('data-appearance="dark"'));
  assert.ok(snippet.includes('data-accent="blue"'));
  assert.ok(snippet.includes('data-button="square"'));
  for (const [field, value] of [
    ['accent', 'url(javascript:bad)'],
    ['appearance', '<script>'],
    ['button', 'unknown'],
  ]) {
    const bad = new URL(url);
    bad.searchParams.set(field, value);
    assert.throws(() => parseWidgetSelection(bad, id));
  }
});
