import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { IntegrationError } from './errors.ts';
export class WebhookDestinationError extends Error {}
export function webhookUrl(value: unknown) {
  try {
    if (
      typeof value !== 'string' ||
      value.length > 2048 ||
      /[\s\\]/.test(value)
    )
      throw 0;
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/.test(
        url.hostname,
      ) ||
      isIP(url.hostname) ||
      /(?:^|\.)(localhost|local|internal|home|test|invalid|example)$/.test(
        url.hostname,
      )
    )
      throw 0;
    return url;
  } catch {
    throw new IntegrationError(
      400,
      'INVALID_WEBHOOK_URL',
      'Use a public HTTPS webhook URL on a registered website, without credentials, query parameters or a custom port.',
    );
  }
}
// Conservative global-unicast allowlist. IPv4-mapped IPv6 and transition networks
// are rejected, as are documentation, multicast, metadata and private ranges.
export function publicWebhookAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6 && !address.includes('.') && !address.includes('%')) {
    const parts = address.toLowerCase().split(':');
    const first = parseInt(parts[0], 16),
      second = parseInt(parts[1] || '0', 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      !(first === 0x3fff && second < 0x1000)
    );
  }
  return false;
}
export type WebhookAddress = { address: string; family: number };
export async function resolveWebhookDestination(
  url: URL,
  resolver: (hostname: string) => Promise<WebhookAddress[]> = (hostname) =>
    lookup(hostname, { all: true }),
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolver(url.hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new WebhookDestinationError('dns_timeout')),
          2000,
        );
      }),
    ]);
    if (
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some(
        (item) =>
          !publicWebhookAddress(item.address) ||
          isIP(item.address) !== item.family,
      )
    )
      throw new WebhookDestinationError('destination_blocked');
    return addresses[0];
  } finally {
    clearTimeout(timeout);
  }
}
