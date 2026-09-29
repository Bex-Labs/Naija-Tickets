import assert from 'node:assert/strict';
import test from 'node:test';
import { startGoogleSignIn } from './google-auth.ts';
import { getSupabaseBrowserClient } from './supabase/client.ts';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-fixture-key';
void test('disabled Google leaves the user in the app with a clear alternative', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ external: { google: false } })),
  );
  await assert.rejects(
    () => startGoogleSignIn('https://tickets.example.com/login?oauth=1'),
    /Please use your email/,
  );
});
void test('enabled Google carries the callback and intended customer destination', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ external: { google: true } })),
  );
  const client = getSupabaseBrowserClient();
  t.mock.method(client.auth, 'signInWithOAuth', async (input: unknown) => {
    assert.deepEqual(input, {
      provider: 'google',
      options: {
        redirectTo: 'https://tickets.example.com/login?oauth=1&next=%2Faccount',
      },
    });
    return {
      data: { provider: 'google', url: 'https://accounts.google.com' },
      error: null,
    };
  });
  await startGoogleSignIn(
    'https://tickets.example.com/login?oauth=1&next=%2Faccount',
  );
});
