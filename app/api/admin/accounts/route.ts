import { NextResponse } from 'next/server';
import {
  addAdminAccount,
  deleteAdminAccount,
  getAdminAccounts,
  MAX_ADMIN_ACCOUNTS,
  publicAdminAccount,
} from '@/lib/admin-credentials';
import { getAuthenticatedAdmin } from '@/lib/admin-request';

async function responseAccounts(currentAdminId: string) {
  const accounts = await getAdminAccounts();
  return {
    accounts: accounts.map((account) =>
      publicAdminAccount(account, currentAdminId),
    ),
    maximum: MAX_ADMIN_ACCOUNTS,
  };
}

export async function GET() {
  const current = await getAuthenticatedAdmin();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  return NextResponse.json(await responseAccounts(current.id));
}

export async function POST(request: Request) {
  const current = await getAuthenticatedAdmin();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword =
    typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!username || !password || !currentPassword) {
    return NextResponse.json(
      { error: 'Complete all administrator details.' },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: 'The new passwords do not match.' },
      { status: 400 },
    );
  }
  try {
    await addAdminAccount({
      actorAdminId: current.id,
      currentPassword,
      username,
      password,
    });
    return NextResponse.json(await responseAccounts(current.id));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Administrator could not be added.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const current = await getAuthenticatedAdmin();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!accountId || !currentPassword) {
    return NextResponse.json(
      { error: 'Your current password is required.' },
      { status: 400 },
    );
  }
  try {
    await deleteAdminAccount({
      actorAdminId: current.id,
      currentPassword,
      accountId,
    });
    return NextResponse.json(await responseAccounts(current.id));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Administrator could not be deleted.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
