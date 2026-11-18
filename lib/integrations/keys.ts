import type { IntegrationEnvironment } from './types.ts';

const TOKEN_PATTERN = /^nt_(test|live)_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/;
export async function credentialDigest(value: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export function parseIntegrationCredential(value: string | null) {
  if (!value || value.length > 128) return null;
  const match = TOKEN_PATTERN.exec(value);
  if (!match) return null;
  const id = match[2];
  return {
    id: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    environment: match[1] as IntegrationEnvironment,
  };
}
export async function generateIntegrationCredential(
  environment: IntegrationEnvironment,
) {
  const id = crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const credential = `nt_${environment}_${id.replaceAll('-', '')}_${secret}`;
  return {
    id,
    credential,
    digest: await credentialDigest(credential),
    prefix: `nt_${environment}_${id.replaceAll('-', '').slice(0, 8)}`,
    suffix: secret.slice(-4),
  };
}
