import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  validateSigningKeys,
  type CheckoutSigningKeys,
} from './checkout-access.ts';
import type { WidgetSelection } from './widget-types.ts';
import { IntegrationError } from './errors.ts';
export type WidgetProof = WidgetSelection & {
  configurationId: string;
  revision: number;
  nonce: string;
  expires: number;
  version: string;
};
const invalid = () =>
  new IntegrationError(
    410,
    'WIDGET_EXPIRED',
    'Refresh the ticket widget and choose your tickets again.',
  );
export function signWidgetProof(
  proof: Omit<WidgetProof, 'version' | 'expires' | 'nonce'>,
  keys: CheckoutSigningKeys,
  now = Date.now(),
) {
  validateSigningKeys(keys);
  const value: WidgetProof = {
    ...proof,
    version: keys.activeVersion,
    expires: Math.floor(now / 1000) + 300,
    nonce: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  return (
    encoded +
    '.' +
    createHmac('sha256', keys.keys[value.version])
      .update('naija.widget.handoff.v1.' + encoded)
      .digest('hex')
  );
}
export function verifyWidgetProof(
  token: string,
  keys: CheckoutSigningKeys,
  now = Date.now(),
): WidgetProof {
  validateSigningKeys(keys);
  if (token.length > 8192) throw invalid();
  const [encoded, signature, extra] = token.split('.');
  if (
    extra ||
    !/^[A-Za-z0-9_-]+$/.test(encoded || '') ||
    !/^[a-f0-9]{64}$/.test(signature || '')
  )
    throw invalid();
  let value: WidgetProof;
  try {
    value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as WidgetProof;
  } catch {
    throw invalid();
  }
  if (
    !value ||
    !Object.hasOwn(keys.keys, value.version) ||
    !Number.isSafeInteger(value.expires) ||
    value.expires <= Math.floor(now / 1000) ||
    value.expires > Math.floor(now / 1000) + 300
  )
    throw invalid();
  const expected = createHmac('sha256', keys.keys[value.version])
    .update('naija.widget.handoff.v1.' + encoded)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw invalid();
  return value;
}
