import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export async function accountFetch(url: string, init: RequestInit = {}) {
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    throw new Error('Your session has expired. Log in again.');
  }

  const request = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const response = await request(data.session.access_token);
  if (response.status !== 401) return response;

  const refreshed = await client.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) return response;
  return request(refreshed.data.session.access_token);
}

export function accountResponseError(response: Response, message?: string) {
  if (response.status === 401) {
    return 'Your sign-in could not be verified. Please log out and log in again.';
  }
  return message || 'Your account information could not be loaded.';
}
