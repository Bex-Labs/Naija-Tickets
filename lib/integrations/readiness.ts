import { integrationResourceMode } from './resource-mode.ts';
import { validateSigningKeys } from './checkout-access.ts';
import { webhookEncryption } from './webhook-encryption.ts';
export const ACCEPTANCE_GATES = [
  'public_purchase_return',
  'free_group_claim_entry',
  'widget_browser',
  'durable_receiver',
  'scheduled_delivery',
  'security_load_review',
  'physical_mobile',
] as const;
export type ReadinessCheck = {
  id: string;
  state: 'pass' | 'pending' | 'disabled' | 'fail';
  message: string;
};
export function integrationReadiness(
  settings: Record<string, string | undefined>,
  evidence: unknown = {},
) {
  const checks: ReadinessCheck[] = [];
  const check = (id: string, ok: boolean, message: string) =>
    checks.push({ id, state: ok ? 'pass' : 'fail', message });
  let mode: string | null = null;
  try {
    mode = integrationResourceMode(settings);
    check(
      'resource_binding',
      true,
      'Deployment resource configuration is structurally valid; stored binding requires remote verification.',
    );
  } catch {
    check(
      'resource_binding',
      false,
      'Configure separate test resources and matching mode; no live fallback is permitted.',
    );
  }
  let publicOrigin = false;
  try {
    const url = new URL(settings.APP_URL || '');
    publicOrigin =
      url.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      (mode !== 'test' || url.hostname !== 'naija-tickets.vercel.app');
  } catch {}
  check(
    'public_origin',
    publicOrigin,
    'A distinct public HTTPS deployment origin is required for online acceptance.',
  );
  check(
    'database_secrets',
    Boolean(
      settings.NEXT_PUBLIC_SUPABASE_URL &&
      settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      settings.SUPABASE_SERVICE_ROLE_KEY,
    ),
    'Matching project credentials must be configured privately; remote role/schema checks are separate.',
  );
  const features = [
    ['hosted_checkout', 'INTEGRATIONS_CHECKOUT_ENABLED'],
    ['webhooks', 'INTEGRATIONS_WEBHOOKS_ENABLED'],
    ['widgets', 'INTEGRATIONS_WIDGETS_ENABLED'],
    ['advanced_operations', 'INTEGRATIONS_ADVANCED_ENABLED'],
    ['delegated_entry', 'INTEGRATIONS_ENTRY_ENABLED'],
  ];
  for (const [id, key] of features)
    checks.push({
      id,
      state: settings[key] === 'true' ? 'pass' : 'disabled',
      message:
        settings[key] === 'true'
          ? 'Server flag enabled; application permissions and actual acceptance still apply.'
          : 'Disabled on this deployment. This is not an accepted purchase feature.',
    });
  if (settings.INTEGRATIONS_CHECKOUT_ENABLED === 'true') {
    try {
      const previous = JSON.parse(
        settings.INTEGRATIONS_PREVIOUS_SIGNING_KEYS || '{}',
      );
      if (!previous || typeof previous !== 'object' || Array.isArray(previous))
        throw Error();
      const keys = validateSigningKeys({
        activeVersion: settings.INTEGRATIONS_SIGNING_KEY_VERSION || 'v1',
        keys: {
          ...previous,
          [settings.INTEGRATIONS_SIGNING_KEY_VERSION || 'v1']:
            settings.INTEGRATIONS_SIGNING_SECRET || '',
        },
      });
      if (
        Object.values(keys.keys).some((secret) =>
          [
            'ADMIN_SESSION_SECRET',
            'PAYSTACK_SECRET_KEY',
            'SUPABASE_SERVICE_ROLE_KEY',
            'CRON_SECRET',
          ].some((name) => secret === settings[name]),
        )
      )
        throw Error();
      check(
        'checkout_signing',
        true,
        'Dedicated versioned signing material is structurally valid.',
      );
    } catch {
      check(
        'checkout_signing',
        false,
        'Configure valid dedicated hosted signing material and bounded previous versions.',
      );
    }
    check(
      'payment_mode',
      Boolean(
        settings.PAYSTACK_SECRET_KEY?.startsWith(
          mode === 'test' ? 'sk_test_' : 'sk_live_',
        ),
      ),
      'The provider secret must match the deployment mode; connectivity is not certified by its prefix.',
    );
  }
  if (settings.INTEGRATIONS_WEBHOOKS_ENABLED === 'true') {
    try {
      webhookEncryption(settings);
      check(
        'webhook_encryption',
        true,
        'Dedicated versioned encryption configuration is structurally valid.',
      );
    } catch {
      check(
        'webhook_encryption',
        false,
        'Configure dedicated canonical encryption keys without secret reuse.',
      );
    }
    const cron = settings.CRON_SECRET;
    check(
      'cron_auth',
      Boolean(
        cron &&
        cron.length >= 43 &&
        cron.length <= 256 &&
        ![
          'INTEGRATIONS_SIGNING_SECRET',
          'ADMIN_SESSION_SECRET',
          'SUPABASE_SERVICE_ROLE_KEY',
          'PAYSTACK_SECRET_KEY',
        ].some((name) => cron === settings[name]),
      ),
      'A separate bounded scheduler credential is required.',
    );
  }
  const record =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>)
      : {};
  let evidenceTarget = false;
  try {
    evidenceTarget =
      record.schemaVersion === 1 &&
      record.environment === mode &&
      record.deploymentOrigin === new URL(settings.APP_URL || '').origin;
  } catch {}
  for (const gate of ACCEPTANCE_GATES) {
    const item = record[gate];
    const verified = Boolean(
      evidenceTarget &&
      item &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).status === 'passed' &&
      typeof (item as Record<string, unknown>).verifiedAt === 'string' &&
      Number.isFinite(
        Date.parse((item as Record<string, unknown>).verifiedAt as string),
      ) &&
      Date.parse((item as Record<string, unknown>).verifiedAt as string) <=
        Date.now() + 300000 &&
      typeof (item as Record<string, unknown>).evidence === 'string' &&
      ((item as Record<string, unknown>).evidence as string).trim().length > 10,
    );
    checks.push({
      id: gate,
      state: verified ? 'pass' : 'pending',
      message: verified
        ? 'Operator-recorded evidence supplied; review its validity before rollout.'
        : 'Actual deployment/browser/provider evidence has not been recorded.',
    });
  }
  return {
    mode,
    checks,
    configurationValid: !checks.some((c) => c.state === 'fail'),
    ready: checks.every((c) => c.state === 'pass'),
    note: 'Local configuration/evidence review only. No secrets are printed and no network request or database change is made.',
  };
}
