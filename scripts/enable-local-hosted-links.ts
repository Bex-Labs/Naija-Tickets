// Local activation only. Does not change Vercel, database records or provider keys.
import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hostedLinkReadiness } from '../lib/integrations/hosted-link-readiness.ts';

const file = new URL('../.env.local', import.meta.url);
try {
  if (process.argv.slice(2).join(' ') !== '--apply')
    throw Error(
      'Use --apply to enable hosted links only in this checkout’s .env.local.',
    );
  let content = await readFile(file, 'utf8');
  const settings = parseEnv(content);
  if (
    new URL(settings.NEXT_PUBLIC_SUPABASE_URL || '').hostname !==
      'pxbjptykiudostxcedqy.supabase.co' ||
    (settings.INTEGRATIONS_RESOURCE_MODE || 'live') !== 'live'
  )
    throw Error('Expected the main Live project. No settings changed.');
  const client = createClient(
    settings.NEXT_PUBLIC_SUPABASE_URL!,
    settings.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const binding = await client
    .rpc('get_integration_resource_settings')
    .abortSignal(AbortSignal.timeout(12000));
  if (binding.error || binding.data?.environment !== 'live')
    throw Error(
      'Live database binding could not be verified. No settings changed.',
    );
  const schema = await client
    .from('integration_hosted_links')
    .select('id')
    .limit(0)
    .abortSignal(AbortSignal.timeout(12000));
  if (schema.error)
    throw Error(
      'Hosted-link schema is missing or unavailable. No settings changed.',
    );
  const updates: Record<string, string> = {
    INTEGRATIONS_RESOURCE_MODE: 'live',
    INTEGRATIONS_CHECKOUT_ENABLED: 'true',
    INTEGRATIONS_HOSTED_LINKS_ENABLED: 'true',
  };
  if (!settings.INTEGRATIONS_SIGNING_SECRET) {
    updates.INTEGRATIONS_SIGNING_KEY_VERSION =
      settings.INTEGRATIONS_SIGNING_KEY_VERSION || 'v1';
    updates.INTEGRATIONS_SIGNING_SECRET = randomBytes(32).toString('base64url');
  }
  const planned = { ...settings, ...updates };
  const readiness = hostedLinkReadiness(planned);
  if (!readiness.hostedLinksAvailable)
    throw Error(
      'Existing signing configuration is invalid. No secrets rotated or settings changed.',
    );
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content)
      ? content.replace(pattern, () => line)
      : content.trimEnd() + '\n' + line + '\n';
  }
  await writeFile(
    new URL('../.env.local.activation.tmp', import.meta.url),
    content,
    { mode: 0o600 },
  );
  await rename(new URL('../.env.local.activation.tmp', import.meta.url), file);
  await chmod(file, 0o600);
  console.log(
    'Local hosted links enabled; dedicated signing configured. Provider key unchanged.',
  );
  console.log(
    readiness.paymentsReady
      ? 'Provider key matches Live mode; actual provider verification/purchase still required.'
      : 'Paid Live checkout remains unavailable: save a valid Paystack Live secret privately before accepting paid purchases.',
  );
} catch (error) {
  // Do not print upstream errors or private configuration.
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Local activation failed. Private details suppressed.',
  );
  process.exitCode = 1;
}
