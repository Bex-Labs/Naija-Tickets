import { limitAdminSignIn, parseAdminSignIn } from '@/lib/admin-login';
import { integrationApiDependencies } from '@/lib/integrations/store.server';
import { readIntegrationJson } from '@/lib/integrations/validation';
import { IntegrationError } from '@/lib/integrations/errors';
import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  adminSessionCookieOptions,
  createAdminSessionToken,
} from '@/lib/admin-auth';
import {
  getAdminAccounts,
  verifyConfiguredAdminCredentials,
} from '@/lib/admin-credentials';

export async function POST(request: Request) {
  let body: { username: string; password: string };
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      throw new IntegrationError(
        403,
        'INVALID_ORIGIN',
        'Use the administrator sign-in page.',
      );
    body = parseAdminSignIn(await readIntegrationJson(request, 4096));
    await limitAdminSignIn(request, body.username, integrationApiDependencies);
  } catch (cause) {
    const error =
      cause instanceof IntegrationError
        ? cause
        : new IntegrationError(
            503,
            'AUTH_UNAVAILABLE',
            'Administrator sign-in is temporarily unavailable.',
          );
    return NextResponse.json(
      { error: error.message },
      {
        status: error.status,
        headers: {
          'Cache-Control': 'private, no-store',
          ...(error.retryAfter
            ? { 'Retry-After': String(error.retryAfter) }
            : {}),
        },
      },
    );
  }

  const requiredSettings = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  };
  const missingSettings = Object.entries(requiredSettings)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missingSettings.length) {
    console.error('Admin sign-in configuration missing', missingSettings);
    return NextResponse.json(
      { error: 'Administrator sign-in is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let account = null;
  try {
    const accounts = await getAdminAccounts();
    if (!accounts.length) {
      return NextResponse.json(
        {
          error: 'Administrator sign-in is not configured on this deployment.',
        },
        { status: 503 },
      );
    }
    account = await verifyConfiguredAdminCredentials(
      body.username,
      body.password,
      accounts,
    );
  } catch (error) {
    console.error('Admin credential verification failed', error);
    return NextResponse.json(
      { error: 'Admin login is temporarily unavailable.' },
      { status: 500 },
    );
  }
  if (!account) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return NextResponse.json(
      { error: 'The admin login ID or password is incorrect.' },
      { status: 401 },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
  response.cookies.set(
    ADMIN_COOKIE_NAME,
    await createAdminSessionToken(account.id, account.passwordHash),
    adminSessionCookieOptions,
  );
  return response;
}
