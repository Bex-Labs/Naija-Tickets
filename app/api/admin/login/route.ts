import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  adminSessionCookieOptions,
  createAdminSessionToken,
} from '@/lib/admin-auth';
import { verifyConfiguredAdminCredentials } from '@/lib/admin-credentials';

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

  let account = null;
  try {
    account = await verifyConfiguredAdminCredentials(
      body.username,
      body.password,
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
      { error: 'The email address or password is incorrect.' },
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
