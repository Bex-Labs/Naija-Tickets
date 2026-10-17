import { IntegrationError } from './errors.ts';
import type { IntegrationEnvironment } from './types.ts';
import { credentialDigest } from './keys.ts';

export type CheckoutSigningKeys = {
  activeVersion: string;
  keys: Record<string, string>;
};
export type HostedSessionIdentity = {
  id: string;
  environment: IntegrationEnvironment;
  expires_at: string;
  signing_key_version: string;
};
export function validateSigningKeys(configuration: CheckoutSigningKeys) {
  if (
    !/^[A-Za-z0-9_-]{1,32}$/.test(configuration.activeVersion) ||
    !Object.hasOwn(configuration.keys, configuration.activeVersion) ||
    Object.keys(configuration.keys).length > 3 ||
    Object.entries(configuration.keys).some(
      ([version, secret]) =>
        !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
        typeof secret !== 'string' ||
        secret.length < 43 ||
        secret.length > 256,
    )
  )
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'Hosted checkout signing is not configured.',
    );
  return configuration;
}
export async function hostedSessionSecret(
  session: HostedSessionIdentity,
  purpose: 'access' | 'reservation',
  configuration: CheckoutSigningKeys,
) {
  validateSigningKeys(configuration);
  const secret = Object.hasOwn(configuration.keys, session.signing_key_version)
    ? configuration.keys[session.signing_key_version]
    : undefined;
  if (!secret)
    throw new IntegrationError(
      503,
      'CHECKOUT_NOT_CONFIGURED',
      'This checkout signing version is unavailable.',
    );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const payload = JSON.stringify([
    'naija.hosted.checkout.v1',
    purpose,
    session.id,
    session.environment,
    new Date(session.expires_at).toISOString(),
    session.signing_key_version,
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
export const hostedSecretDigest = credentialDigest;
export const isHostedSecret = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
