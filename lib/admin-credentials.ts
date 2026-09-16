import {
  derivePasswordHash,
  getEnvironmentAdminCredentials,
  type AdminCredentialRecord,
  verifyAdminCredentials,
} from '@/lib/admin-auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

const LEGACY_SETTINGS_KEY = 'admin_credentials';
const ACCOUNTS_SETTINGS_KEY = 'admin_accounts';
export const MAX_ADMIN_ACCOUNTS = 3;

type StoredAdminCredentials = {
  id?: unknown;
  username?: unknown;
  password_salt?: unknown;
  password_hash?: unknown;
  created_at?: unknown;
};

function parseStoredCredentials(
  value: unknown,
  fallbackId = 'primary',
): AdminCredentialRecord | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as StoredAdminCredentials;
  if (
    typeof stored.username !== 'string' ||
    typeof stored.password_salt !== 'string' ||
    typeof stored.password_hash !== 'string'
  ) {
    return null;
  }

  const id = typeof stored.id === 'string' ? stored.id : fallbackId;
  if (!id) return null;

  return {
    id,
    username: stored.username,
    passwordSalt: stored.password_salt,
    passwordHash: stored.password_hash,
    createdAt:
      typeof stored.created_at === 'string'
        ? stored.created_at
        : '2026-09-12T00:00:00.000Z',
  };
}

function accountValue(account: AdminCredentialRecord) {
  return {
    id: account.id,
    username: account.username,
    password_salt: account.passwordSalt,
    password_hash: account.passwordHash,
    created_at: account.createdAt,
  };
}

async function readSetting(key: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value;
}

async function getLegacyAdminCredentials() {
  try {
    return (
      parseStoredCredentials(await readSetting(LEGACY_SETTINGS_KEY)) ||
      getEnvironmentAdminCredentials()
    );
  } catch (error) {
    console.error('Stored admin credential lookup failed', error);
    return getEnvironmentAdminCredentials();
  }
}

export async function getAdminAccounts() {
  try {
    const value = await readSetting(ACCOUNTS_SETTINGS_KEY);
    if (value && typeof value === 'object') {
      const rawAccounts = (value as { accounts?: unknown }).accounts;
      if (Array.isArray(rawAccounts)) {
        const accounts = rawAccounts
          .map((account, index) =>
            parseStoredCredentials(account, index === 0 ? 'primary' : ''),
          )
          .filter((account): account is AdminCredentialRecord =>
            Boolean(account),
          );
        if (accounts.length) return accounts.slice(0, MAX_ADMIN_ACCOUNTS);
      }
    }
  } catch (error) {
    console.error('Admin account list lookup failed', error);
  }

  const legacy = await getLegacyAdminCredentials();
  return legacy ? [legacy] : [];
}

export async function getAdminAccountById(accountId: string) {
  const accounts = await getAdminAccounts();
  return accounts.find((account) => account.id === accountId) || null;
}

export async function verifyConfiguredAdminCredentials(
  username: string,
  password: string,
) {
  const accounts = await getAdminAccounts();
  const results = await Promise.all(
    accounts.map(async (account) => ({
      account,
      valid: await verifyAdminCredentials(username, password, account),
    })),
  );
  return results.find((result) => result.valid)?.account || null;
}

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function validateUsername(username: string) {
  const value = username.trim();
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(value)) {
    throw new Error(
      'Use 3 to 80 letters, numbers, full stops, underscores or hyphens for the login ID.',
    );
  }
  return value;
}

function validatePassword(password: string) {
  if (password.length < 12) {
    throw new Error('The password must contain at least 12 characters.');
  }
}

async function saveAccounts(
  accounts: AdminCredentialRecord[],
  action: string,
  actorAdminId: string,
  metadata: Record<string, unknown>,
) {
  const client = getSupabaseAdminClient();
  const { error } = await client.from('platform_settings').upsert({
    key: ACCOUNTS_SETTINGS_KEY,
    value: { accounts: accounts.map(accountValue) },
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  const { error: auditError } = await client.from('audit_logs').insert({
    action,
    entity_type: 'platform_settings',
    entity_id: ACCOUNTS_SETTINGS_KEY,
    metadata: { actor_admin_id: actorAdminId, ...metadata },
  });
  if (auditError) console.error('Admin account audit failed', auditError);
}

async function verifyActorPassword(actorAdminId: string, password: string) {
  const accounts = await getAdminAccounts();
  const actor = accounts.find((account) => account.id === actorAdminId);
  if (
    !actor ||
    !(await verifyAdminCredentials(actor.username, password, actor))
  ) {
    throw new Error('Your current password is incorrect.');
  }
  return { accounts, actor };
}

export async function updateAdminCredentials({
  accountId,
  currentPassword,
  username,
  newPassword,
}: {
  accountId: string;
  currentPassword: string;
  username: string;
  newPassword?: string;
}) {
  const { accounts, actor } = await verifyActorPassword(
    accountId,
    currentPassword,
  );
  const nextUsername = validateUsername(username);
  if (
    accounts.some(
      (account) =>
        account.id !== accountId &&
        account.username.toLowerCase() === nextUsername.toLowerCase(),
    )
  ) {
    throw new Error('That admin login ID is already in use.');
  }
  if (newPassword) validatePassword(newPassword);

  const passwordSalt = newPassword ? randomHex(24) : actor.passwordSalt;
  const passwordHash = newPassword
    ? await derivePasswordHash(newPassword, passwordSalt)
    : actor.passwordHash;
  const updated = accounts.map((account) =>
    account.id === accountId
      ? {
          ...account,
          username: nextUsername,
          passwordSalt,
          passwordHash,
        }
      : account,
  );
  await saveAccounts(updated, 'admin.credentials_updated', accountId, {
    username_changed: actor.username !== nextUsername,
    password_changed: Boolean(newPassword),
  });
  return { username: nextUsername };
}

export async function addAdminAccount({
  actorAdminId,
  currentPassword,
  username,
  password,
}: {
  actorAdminId: string;
  currentPassword: string;
  username: string;
  password: string;
}) {
  const { accounts } = await verifyActorPassword(actorAdminId, currentPassword);
  if (accounts.length >= MAX_ADMIN_ACCOUNTS) {
    throw new Error('The maximum of three administrator accounts is reached.');
  }
  const nextUsername = validateUsername(username);
  validatePassword(password);
  if (
    accounts.some(
      (account) =>
        account.username.toLowerCase() === nextUsername.toLowerCase(),
    )
  ) {
    throw new Error('That admin login ID is already in use.');
  }

  const passwordSalt = randomHex(24);
  const account: AdminCredentialRecord = {
    id: crypto.randomUUID(),
    username: nextUsername,
    passwordSalt,
    passwordHash: await derivePasswordHash(password, passwordSalt),
    createdAt: new Date().toISOString(),
  };
  await saveAccounts(
    [...accounts, account],
    'admin.account_created',
    actorAdminId,
    { created_admin_id: account.id },
  );
  return account;
}

export async function deleteAdminAccount({
  actorAdminId,
  currentPassword,
  accountId,
}: {
  actorAdminId: string;
  currentPassword: string;
  accountId: string;
}) {
  const { accounts } = await verifyActorPassword(actorAdminId, currentPassword);
  if (accountId === 'primary') {
    throw new Error('The primary administrator cannot be deleted.');
  }
  if (accountId === actorAdminId) {
    throw new Error('You cannot delete the account you are using.');
  }
  if (!accounts.some((account) => account.id === accountId)) {
    throw new Error('Administrator account not found.');
  }
  await saveAccounts(
    accounts.filter((account) => account.id !== accountId),
    'admin.account_deleted',
    actorAdminId,
    { deleted_admin_id: accountId },
  );
}

export function publicAdminAccount(
  account: AdminCredentialRecord,
  currentAdminId: string,
) {
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt,
    isPrimary: account.id === 'primary',
    isCurrent: account.id === currentAdminId,
  };
}
