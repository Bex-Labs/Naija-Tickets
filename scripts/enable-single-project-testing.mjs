// One-time local activation. No second project, no credential output.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
const root = resolve(import.meta.dirname, '..');
const load = async (name) => {
  try {
    return parseEnv(await readFile(resolve(root, name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
};
const settings = {
  ...(await load('.env.local')),
  ...(await load('.env.development.local')),
};
if (!settings.NEXT_PUBLIC_SUPABASE_URL || !settings.SUPABASE_SERVICE_ROLE_KEY)
  throw Error('Restore the existing main .env.local before activation.');
const client = createClient(
  settings.NEXT_PUBLIC_SUPABASE_URL,
  settings.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const { data, error } = await client
  .rpc('get_integration_resource_settings')
  .abortSignal(AbortSignal.timeout(10000));
if (
  error ||
  data?.environment !== 'live' ||
  data?.local_testing_enabled !== true
)
  throw Error(
    'Apply 202611130001_single_project_testing.sql to the main database first. No environment settings were changed.',
  );
const schemaCheck = await client
  .from('events')
  .select('id,is_test,external_managed')
  .limit(1)
  .abortSignal(AbortSignal.timeout(10000));
if (schemaCheck.error)
  throw Error(
    'Install the existing external-event migration (202610290001) and single-project testing migration before activation. No settings changed.',
  );
if (
  !settings.INTEGRATIONS_SIGNING_SECRET ||
  settings.INTEGRATIONS_SIGNING_SECRET.length < 43
)
  throw Error('The existing checkout signing secret is missing or too short.');
const testKey =
  settings.PAYSTACK_TEST_SECRET_KEY ||
  (settings.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')
    ? settings.PAYSTACK_SECRET_KEY
    : '');
if (!testKey?.startsWith('sk_test_'))
  throw Error(
    'Set PAYSTACK_TEST_SECRET_KEY privately to your Paystack Test secret first. No settings changed.',
  );
const target = resolve(root, '.env.development.local');
let contents = '';
try {
  contents = await readFile(target, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const changes = {
  INTEGRATIONS_LOCAL_TESTING_ENABLED: 'true',
  INTEGRATIONS_TEST_ENABLED: 'false',
  PAYSTACK_TEST_SECRET_KEY: testKey,
};
for (const [name, value] of Object.entries(changes)) {
  const line = `${name}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  contents = pattern.test(contents)
    ? contents.replace(pattern, line)
    : contents + `\n${line}\n`;
}
if (!process.argv.includes('--check-only'))
  await writeFile(target, contents, { mode: 0o600 });
console.log(
  process.argv.includes('--check-only')
    ? 'Single-project testing is ready to activate.'
    : 'Single-project testing enabled locally. Restart npm run dev. Main payment preferences were preserved.',
);
