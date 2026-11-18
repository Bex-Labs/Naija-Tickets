import {
  ADMIN_COOKIE_NAME,
  adminSessionCookieOptions,
  createAdminSessionToken,
} from '@/lib/admin-auth';
import { NextResponse } from 'next/server';
import {
  updateAdminCredentials,
  getAdminAccountById,
} from '@/lib/admin-credentials';
import { getAuthenticatedAdmin } from '@/lib/admin-request';

export async function GET() {
  const account = await getAuthenticatedAdmin();
  if (!account) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  try {
    return NextResponse.json({ username: account.username });
  } catch (error) {
    console.error('Admin settings read failed', error);
    return NextResponse.json(
      { error: 'Admin settings are temporarily unavailable.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const account = await getAuthenticatedAdmin();
  if (!account) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  const username = values.username;
  const currentPassword = values.currentPassword;
  const newPassword = values.newPassword;
  const confirmPassword = values.confirmPassword;
  if (
    typeof username !== 'string' ||
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { error: 'The new passwords do not match.' },
      { status: 400 },
    );
  }

  try {
    const result = await updateAdminCredentials({
      accountId: account.id,
      username,
      currentPassword,
      newPassword: newPassword || undefined,
    });
    const response = NextResponse.json(
      { ...result, ok: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
    const refreshed = await getAdminAccountById(account.id);
    if (refreshed)
      response.cookies.set(
        ADMIN_COOKIE_NAME,
        await createAdminSessionToken(refreshed.id, refreshed.passwordHash),
        adminSessionCookieOptions,
      );
    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Admin settings could not be saved.';
    const expectedError =
      message.includes('incorrect') ||
      message.includes('letters') ||
      message.includes('12 to 1024') ||
      message.includes('already in use');
    if (!expectedError) console.error('Admin settings update failed', error);
    return NextResponse.json(
      { error: expectedError ? message : 'Admin settings could not be saved.' },
      { status: expectedError ? 400 : 500 },
    );
  }
}
