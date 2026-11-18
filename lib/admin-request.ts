import { cookies } from 'next/headers';
import {
  ADMIN_COOKIE_NAME,
  getAdminSessionAccountId,
  adminSessionMatchesCredential,
} from '@/lib/admin-auth';
import { getAdminAccountById } from '@/lib/admin-credentials';

export async function getAuthenticatedAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const accountId = await getAdminSessionAccountId(token);
  if (!accountId) return null;
  const account = await getAdminAccountById(accountId);
  return account &&
    (await adminSessionMatchesCredential(token, account.passwordHash))
    ? account
    : null;
}
