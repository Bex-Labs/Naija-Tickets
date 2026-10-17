import type {
  CheckoutSigningKeys,
  HostedSessionIdentity,
} from './checkout-access.ts';

// Web APIs only: this verifier also runs in Vercel Routing Middleware.
export type PopupPermit = {
  session: string;
  parent: string;
  environment: 'test' | 'live';
  expires: number;
  version: string;
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const encode = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytes = (value: string) => new TextEncoder().encode(value);
function safeParent(value: string, environment: string) {
  const url = new URL(value);
  return (
    url.origin === value &&
    !url.hostname.includes('*') &&
    !url.username &&
    !url.password &&
    (url.protocol === 'https:' ||
      (environment === 'test' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  );
}
async function hmac(secret: string) {
  if (secret.length < 43 || secret.length > 256)
    throw new Error('Invalid signing configuration');
  return crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function createPopupPermit(
  session: HostedSessionIdentity,
  parent: string,
  keys: CheckoutSigningKeys,
) {
  if (!safeParent(parent, session.environment))
    throw new Error('Invalid popup origin');
  const permit: PopupPermit = {
    session: session.id,
    parent,
    environment: session.environment,
    expires: Date.parse(session.expires_at),
    version: session.signing_key_version,
  };
  const payload = encode(JSON.stringify(permit));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await hmac(keys.keys[permit.version]),
      bytes('naija.checkout.frame.v1.' + payload),
    ),
  );
  return payload + '.' + encode(String.fromCharCode(...signature));
}
export async function verifyPopupPermit(
  token: unknown,
  sessionId: string,
  keys: CheckoutSigningKeys,
  now = Date.now(),
): Promise<PopupPermit | null> {
  try {
    if (
      typeof token !== 'string' ||
      token.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)
    )
      return null;
    const [payload, signature] = token.split('.');
    const decode = (value: string) =>
      atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const permit = JSON.parse(decode(payload)) as PopupPermit;
    if (
      !uuid.test(permit.session) ||
      permit.session !== sessionId ||
      !['test', 'live'].includes(permit.environment) ||
      !Number.isSafeInteger(permit.expires) ||
      permit.expires <= now ||
      permit.expires > now + 31 * 60_000 ||
      typeof permit.parent !== 'string' ||
      !safeParent(permit.parent, permit.environment) ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(permit.version) ||
      !Object.hasOwn(keys.keys, permit.version)
    )
      return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmac(keys.keys[permit.version]),
      Uint8Array.from(decode(signature), (c) => c.charCodeAt(0)),
      bytes('naija.checkout.frame.v1.' + payload),
    );
    return valid ? permit : null;
  } catch {
    return null;
  }
}
export async function popupUrl(
  session: HostedSessionIdentity,
  access: string,
  parent: string,
  origin: string,
  keys: CheckoutSigningKeys,
) {
  const url = new URL(`/embed/checkout/${session.id}`, origin);
  url.searchParams.set(
    'permit',
    await createPopupPermit(session, parent, keys),
  );
  url.hash = new URLSearchParams({ access }).toString();
  return url.toString();
}
