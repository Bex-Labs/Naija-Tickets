const encoder = new TextEncoder();

export const ADMIN_COOKIE_NAME = 'naija_admin_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

export type AdminCredentialRecord = {
  id: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
};

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function safeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

export async function derivePasswordHash(password: string, salt: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${salt}\u0000${password}`),
  );

  return bytesToHex(hash);
}

async function sign(value: string) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return '';

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return bytesToHex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
  );
}

export function getEnvironmentAdminCredentials(): AdminCredentialRecord | null {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  const salt = process.env.ADMIN_PASSWORD_SALT;

  if (!expectedUsername || !expectedHash || !salt) return null;

  return {
    id: 'primary',
    username: expectedUsername,
    passwordSalt: salt,
    passwordHash: expectedHash,
    createdAt: '2026-09-12T00:00:00.000Z',
  };
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
  credentials = getEnvironmentAdminCredentials(),
) {
  if (!credentials) return false;

  const suppliedHash = await derivePasswordHash(
    password,
    credentials.passwordSalt,
  );
  return (
    safeEqual(username.trim(), credentials.username) &&
    safeEqual(suppliedHash, credentials.passwordHash)
  );
}

export async function createAdminSessionToken(adminId = 'primary') {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const value = `${expiresAt}.${adminId}`;
  const signature = await sign(value);
  return `${value}.${signature}`;
}

export async function getAdminSessionAccountId(token?: string) {
  if (!token) return null;

  const parts = token.split('.');
  const legacy = parts.length === 2;
  const [expiresValue, accountId, suppliedSignature] = legacy
    ? [parts[0], 'primary', parts[1]]
    : parts;
  if (!expiresValue || !accountId || !suppliedSignature || parts.length > 3) {
    return null;
  }

  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) {
    return null;
  }

  const expectedSignature = await sign(
    legacy ? expiresValue : `${expiresValue}.${accountId}`,
  );
  const valid =
    Boolean(expectedSignature) &&
    safeEqual(suppliedSignature, expectedSignature);
  return valid ? accountId : null;
}

export async function verifyAdminSessionToken(token?: string) {
  return Boolean(await getAdminSessionAccountId(token));
}

export const adminSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: SESSION_DURATION_SECONDS,
};
