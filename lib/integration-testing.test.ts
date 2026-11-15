import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalIntegrationOrigin } from './integrations/validation.ts';
import {
  setupStatus,
  validateWebsiteSetup,
  testServiceConfiguration,
  usesIntegratedTesting,
} from './integrations/testing.ts';

const config = {
  INTEGRATIONS_TEST_ENABLED: 'true',
  NEXT_PUBLIC_SUPABASE_URL: 'https://' + 'b'.repeat(20) + '.supabase.co',
  INTEGRATIONS_TEST_SUPABASE_URL: 'https://' + 'a'.repeat(20) + '.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'main-private-fixture',
  INTEGRATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY: 'test-private-fixture',
  INTEGRATIONS_TEST_CHECKOUT_ORIGIN: 'https://test-checkout.example',
  INTEGRATIONS_TEST_BRIDGE_SECRET: 'bridge-fixture-'.repeat(5),
  INTEGRATIONS_TEST_SIGNING_SECRET: 'test-signing-fixture-'.repeat(4),
};
void test('local testing, hosted testing and real purchases have distinct labels and address rules', () => {
  assert.equal(setupStatus('local', 'test'), 'Local testing · No real charges');
  assert.equal(
    setupStatus('hosted', 'test'),
    'Hosted testing · No real charges',
  );
  assert.equal(setupStatus('hosted', 'live'), 'Live sales · Real payments');
  for (const url of [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://[::1]:5500',
  ])
    assert.doesNotThrow(() => validateWebsiteSetup('local', 'test', [url]));
  assert.doesNotThrow(() =>
    validateWebsiteSetup('hosted', 'test', ['https://mywebsite.example']),
  );
  assert.doesNotThrow(() =>
    validateWebsiteSetup('hosted', 'live', ['https://mywebsite.example']),
  );
  assert.throws(
    () => validateWebsiteSetup('local', 'live', ['http://localhost:5500']),
    /Test a purchase/,
  );
  assert.throws(
    () => validateWebsiteSetup('hosted', 'test', ['http://localhost:5500']),
    /On my computer/,
  );
  assert.throws(
    () => validateWebsiteSetup('local', 'test', ['https://mywebsite.example']),
    /On the internet/,
  );
  assert.throws(
    () => validateWebsiteSetup('hosted', 'test', ['http://mywebsite.example']),
    /HTTPS/,
  );
  assert.throws(
    () =>
      canonicalIntegrationOrigin(
        'http://127.0.0.1:5500/dist/index.html',
        'test',
      ),
    /Enter only http:\/\/127.0.0.1:5500/,
  );
});
void test('integrated testing cannot share the production database, credentials or signing material', () => {
  assert.equal(testServiceConfiguration(config).sourceProject, 'b'.repeat(20));
  assert.equal(
    testServiceConfiguration({
      ...config,
      INTEGRATIONS_TEST_CHECKOUT_ORIGIN: 'http://localhost:3110',
    }).checkoutOrigin,
    'http://localhost:3110',
  );
  for (const patch of [
    { INTEGRATIONS_TEST_ENABLED: 'false' },
    { INTEGRATIONS_TEST_SUPABASE_URL: config.NEXT_PUBLIC_SUPABASE_URL },
    {
      INTEGRATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY:
        config.SUPABASE_SERVICE_ROLE_KEY,
    },
    { INTEGRATIONS_TEST_CHECKOUT_ORIGIN: 'http://public.example' },
    {
      INTEGRATIONS_TEST_CHECKOUT_ORIGIN: 'https://user:password@public.example',
    },
    { INTEGRATIONS_TEST_CHECKOUT_ORIGIN: 'https://public.example/path' },
    {
      INTEGRATIONS_TEST_SIGNING_SECRET: config.INTEGRATIONS_TEST_BRIDGE_SECRET,
    },
    { INTEGRATIONS_TEST_BRIDGE_SECRET: 'short' },
    { INTEGRATIONS_SIGNING_SECRET: config.INTEGRATIONS_TEST_SIGNING_SECRET },
  ])
    assert.throws(
      () => testServiceConfiguration({ ...config, ...patch }),
      /not enabled/,
    );
  assert.equal(usesIntegratedTesting('test', {}), true);
  assert.equal(usesIntegratedTesting('live', config), false);
  assert.equal(
    usesIntegratedTesting('test', { INTEGRATIONS_RESOURCE_MODE: 'test' }),
    false,
  );
});

void test('single-project testing uses the existing database and app origin without a second service', () => {
  const local = {
    INTEGRATIONS_LOCAL_TESTING_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: config.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: config.SUPABASE_SERVICE_ROLE_KEY,
    INTEGRATIONS_SIGNING_SECRET: 'main-checkout-signing-fixture-'.repeat(3),
    APP_URL: 'http://localhost:3000',
  };
  const result = testServiceConfiguration(local);
  assert.equal(result.local, true);
  assert.equal(result.databaseUrl, local.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(result.sourceProject, result.project);
  assert.equal(result.checkoutOrigin, 'http://localhost:3000');
  assert.equal(
    testServiceConfiguration({
      ...local,
      APP_URL: 'https://tickets.example',
      VERCEL: '1',
    }).checkoutOrigin,
    'https://tickets.example',
  );
  assert.throws(() =>
    testServiceConfiguration({
      ...local,
      APP_URL: 'https://user:secret@example.com',
    }),
  );
  assert.throws(() => testServiceConfiguration({ ...local, VERCEL: '1' }));
});
