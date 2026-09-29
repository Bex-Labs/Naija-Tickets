import { getSupabaseBrowserClient } from './supabase/client.ts';

export async function startGoogleSignIn(redirectTo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Sign-in is temporarily unavailable.');
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error('Google sign-in could not be started. Please try again.');
  const settings = (await response.json()) as {
    external?: { google?: boolean };
  };
  if (!settings.external?.google)
    throw new Error(
      'Google sign-in is not available yet. Please use your email to continue.',
    );
  const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
}
