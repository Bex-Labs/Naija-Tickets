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
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('username' in body) ||
    !('password' in body) ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
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

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    ADMIN_COOKIE_NAME,
    await createAdminSessionToken(account.id),
    adminSessionCookieOptions,
  );
  return response;
}
