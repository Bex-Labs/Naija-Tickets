import { scrypt } from 'node:crypto';
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

export async function deriveLegacyAdminHash(password: string, salt: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${salt}\u0000${password}`),
  );

  return bytesToHex(hash);
}

export async function derivePasswordHash(password: string, salt: string) {
  if (
    !password ||
    password.length > 1024 ||
    salt.length < 16 ||
    salt.length > 256
  )
    throw new Error('Invalid password configuration.');
  const digest = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
  return 'scrypt-v1:' + digest.toString('hex');
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

  if (
    !password ||
    password.length > 1024 ||
    !/^(?:[a-f0-9]{64}|scrypt-v1:[a-f0-9]{128})$/.test(credentials.passwordHash)
  )
    return false;
  const suppliedHash = credentials.passwordHash.startsWith('scrypt-v1:')
    ? await derivePasswordHash(password, credentials.passwordSalt)
    : await deriveLegacyAdminHash(password, credentials.passwordSalt);
  return (
    safeEqual(username.trim(), credentials.username) &&
    safeEqual(suppliedHash, credentials.passwordHash)
  );
}

export async function createAdminSessionToken(
  adminId = 'primary',
  credentialHash?: string,
) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const value = credentialHash
    ? `v2.${expiresAt}.${adminId}.${await sign('admin.credential.v2.' + credentialHash)}`
    : `${expiresAt}.${adminId}`;
  return `${value}.${await sign(value)}`;
}
export async function getAdminSessionAccountId(token?: string) {
  if (!token || token.length > 500) return null;
  const parts = token.split('.');
  const modern = parts[0] === 'v2';
  if (modern) {
    if (parts.length !== 5 || !/^[a-f0-9]{64}$/.test(parts[3])) return null;
    const expires = Number(parts[1]);
    if (
      !Number.isSafeInteger(expires) ||
      expires <= Date.now() / 1000 ||
      expires > Date.now() / 1000 + SESSION_DURATION_SECONDS ||
      !/^(primary|[a-f0-9-]{36})$/.test(parts[2])
    )
      return null;
    const expected = await sign(parts.slice(0, 4).join('.'));
    return expected && safeEqual(expected, parts[4]) ? parts[2] : null;
  }
  const legacy = parts.length === 2;
  if (!legacy && parts.length !== 3) return null;
  const [expiresValue, accountId, supplied] = legacy
    ? [parts[0], 'primary', parts[1]]
    : parts;
  const expires = Number(expiresValue);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() / 1000 ||
    !accountId ||
    !supplied
  )
    return null;
  const expected = await sign(
    legacy ? expiresValue : `${expiresValue}.${accountId}`,
  );
  return expected && safeEqual(expected, supplied) ? accountId : null;
}
export async function adminSessionMatchesCredential(
  token: string | undefined,
  credentialHash: string,
) {
  if (!token?.startsWith('v2.') || !(await getAdminSessionAccountId(token)))
    return false;
  return safeEqual(
    token.split('.')[3],
    await sign('admin.credential.v2.' + credentialHash),
  );
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
