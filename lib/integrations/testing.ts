import { IntegrationError } from './errors.ts';
import { canonicalIntegrationOrigin } from './validation.ts';
import type { IntegrationEnvironment } from './types.ts';

export type WebsiteLocation = 'local' | 'hosted';
export function websiteLocation(origin: string): WebsiteLocation {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(origin).hostname,
    )
      ? 'local'
      : 'hosted';
  } catch {
    return 'hosted';
  }
}
export function setupStatus(
  location: WebsiteLocation,
  mode: IntegrationEnvironment,
) {
  if (mode === 'live') return 'Live sales · Real payments';
  return `${location === 'local' ? 'Local' : 'Hosted'} testing · No real charges`;
}
export function validateWebsiteSetup(
  location: unknown,
  mode: IntegrationEnvironment,
  origins: string[],
) {
  if (location !== 'local' && location !== 'hosted')
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Choose where your website is running.',
    );
  if (mode === 'live' && location === 'local')
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Choose Test a purchase for a website running on your computer.',
    );
  if (!origins.length)
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Enter your website address.',
    );
  for (const origin of origins) {
    canonicalIntegrationOrigin(origin, mode);
    if (websiteLocation(origin) !== location)
      throw new IntegrationError(
        400,
        'INVALID_REQUEST',
        location === 'local'
          ? 'Use your local address, such as http://localhost:5500, or choose On the internet.'
          : 'Use an HTTPS website address, or choose On my computer for localhost.',
      );
  }
}

type Settings = Record<string, string | undefined>;
export function usesIntegratedTesting(
  mode: IntegrationEnvironment,
  settings: Settings,
) {
  return (
    mode === 'test' &&
    (settings.INTEGRATIONS_RESOURCE_MODE ?? 'live') === 'live'
  );
}
export function testServiceConfiguration(settings: Settings) {
  if (settings.INTEGRATIONS_LOCAL_TESTING_ENABLED === 'true') {
    let database: URL, checkout: URL;
    try {
      database = new URL(settings.NEXT_PUBLIC_SUPABASE_URL || '');
      checkout = new URL(settings.APP_URL || '');
    } catch {
      throw new IntegrationError(
        503,
        'TESTING_UNAVAILABLE',
        'Test checkout needs the app address and existing database configured on the server.',
      );
    }
    const project = database.hostname.split('.')[0];
    if (
      database.protocol !== 'https:' ||
      database.hostname !== `${project}.supabase.co` ||
      !/^[a-z0-9]{20}$/.test(project) ||
      !settings.SUPABASE_SERVICE_ROLE_KEY ||
      !settings.INTEGRATIONS_SIGNING_SECRET ||
      settings.INTEGRATIONS_SIGNING_SECRET.length < 43 ||
      [
        settings.SUPABASE_SERVICE_ROLE_KEY,
        settings.PAYSTACK_SECRET_KEY,
        settings.PAYSTACK_TEST_SECRET_KEY,
        settings.ADMIN_SESSION_SECRET,
      ]
        .filter(Boolean)
        .includes(settings.INTEGRATIONS_SIGNING_SECRET) ||
      !['http:', 'https:'].includes(checkout.protocol) ||
      checkout.username ||
      checkout.password ||
      (checkout.protocol === 'http:' &&
        websiteLocation(checkout.origin) !== 'local') ||
      (settings.VERCEL === '1' && websiteLocation(checkout.origin) === 'local')
    )
      throw new IntegrationError(
        503,
        'TESTING_UNAVAILABLE',
        'Check the app address, database and checkout signing settings on the server.',
      );
    return {
      local: true,
      databaseUrl: database.origin,
      serviceKey: settings.SUPABASE_SERVICE_ROLE_KEY,
      checkoutOrigin: checkout.origin,
      project,
      sourceProject: project,
      // A purpose-separated digest is derived on the server, never in browser code.
      bridgeSecret: settings.INTEGRATIONS_SIGNING_SECRET,
      signingSecret: settings.INTEGRATIONS_SIGNING_SECRET,
      signingVersion: settings.INTEGRATIONS_SIGNING_KEY_VERSION || 'v1',
    };
  }
  const unavailable = (): never => {
    throw new IntegrationError(
      503,
      'TESTING_UNAVAILABLE',
      'Test checkout is not enabled yet. Ask the platform administrator to enable single-project testing on this app.',
    );
  };
  if (settings.INTEGRATIONS_TEST_ENABLED !== 'true') return unavailable();
  let database: URL,
    main: URL,
    checkout: URL,
    appOrigin: string | null = null;
  try {
    database = new URL(settings.INTEGRATIONS_TEST_SUPABASE_URL || '');
    main = new URL(settings.NEXT_PUBLIC_SUPABASE_URL || '');
    checkout = new URL(settings.INTEGRATIONS_TEST_CHECKOUT_ORIGIN || '');
    if (settings.APP_URL) appOrigin = new URL(settings.APP_URL).origin;
  } catch {
    return unavailable();
  }
  const project = database.hostname.split('.')[0],
    sourceProject = main.hostname.split('.')[0];
  if (
    database.protocol !== 'https:' ||
    database.hostname !== `${project}.supabase.co` ||
    main.protocol !== 'https:' ||
    main.hostname !== `${sourceProject}.supabase.co` ||
    !/^[a-z0-9]{20}$/.test(project) ||
    !/^[a-z0-9]{20}$/.test(sourceProject) ||
    project === sourceProject ||
    database.origin !== database.href.replace(/\/$/, '') ||
    checkout.username ||
    checkout.password ||
    checkout.pathname !== '/' ||
    checkout.search ||
    checkout.hash ||
    (settings.VERCEL === '1' && websiteLocation(checkout.origin) === 'local') ||
    checkout.origin === appOrigin ||
    (checkout.protocol !== 'https:' &&
      !(
        checkout.protocol === 'http:' &&
        websiteLocation(checkout.origin) === 'local'
      )) ||
    !settings.INTEGRATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY ||
    settings.INTEGRATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY ===
      settings.SUPABASE_SERVICE_ROLE_KEY
  )
    return unavailable();
  const bridge = settings.INTEGRATIONS_TEST_BRIDGE_SECRET || '',
    signing = settings.INTEGRATIONS_TEST_SIGNING_SECRET || '';
  const existing = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'PAYSTACK_SECRET_KEY',
    'ADMIN_SESSION_SECRET',
    'INTEGRATIONS_SIGNING_SECRET',
  ]
    .map((key) => settings[key])
    .filter(Boolean);
  if (
    bridge.length < 43 ||
    bridge.length > 256 ||
    signing.length < 43 ||
    signing.length > 256 ||
    bridge === signing ||
    existing.includes(bridge) ||
    existing.includes(signing)
  )
    return unavailable();
  return {
    local: false,
    databaseUrl: database.origin,
    serviceKey: settings.INTEGRATIONS_TEST_SUPABASE_SERVICE_ROLE_KEY,
    checkoutOrigin: checkout.origin,
    project,
    sourceProject,
    bridgeSecret: bridge,
    signingSecret: signing,
    signingVersion: settings.INTEGRATIONS_TEST_SIGNING_KEY_VERSION || 'v1',
  };
}
