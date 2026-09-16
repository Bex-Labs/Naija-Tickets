import { cookies } from 'next/headers';
import { ADMIN_COOKIE_NAME, getAdminSessionAccountId } from '@/lib/admin-auth';
import { getAdminAccountById } from '@/lib/admin-credentials';

export async function getAuthenticatedAdmin() {
  const cookieStore = await cookies();
  const accountId = await getAdminSessionAccountId(
    cookieStore.get(ADMIN_COOKIE_NAME)?.value,
  );
  if (!accountId) return null;
  return getAdminAccountById(accountId);
}
