import { IntegrationError } from './errors.ts';
import { INTEGRATION_SCOPES } from './types.ts';
import type {
  IntegrationDomain,
  IntegrationEnvironment,
  IntegrationScope,
} from './types.ts';
export const INTEGRATION_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = (message: string): never => {
  throw new IntegrationError(400, 'INVALID_REQUEST', message);
};
export function integrationId(value: unknown) {
  return typeof value === 'string' && INTEGRATION_ID_PATTERN.test(value)
    ? value.toLowerCase()
    : invalid('Enter a valid integration or organiser identifier.');
}
export function integrationEnvironment(value: unknown): IntegrationEnvironment {
  return value === 'test' || value === 'live'
    ? value
    : invalid('Choose test or live credentials.');
}
export function canonicalIntegrationOrigin(
  value: unknown,
  environment: IntegrationEnvironment,
) {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    value.includes('*') ||
    /[\s\\]/.test(value)
  )
    return invalid('Use an exact website origin without paths or wildcards.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid('Enter a valid website origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(environment === 'test' && local && url.protocol === 'http:')) ||
    (environment === 'live' && local) ||
    (url.protocol === 'https:' &&
      !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(url.hostname))
  ) {
    return invalid(
      'Use HTTPS origins; HTTP localhost is allowed only for test integrations.',
    );
  }
  return url.origin;
}
function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid('Enter a valid integration configuration.');
  return value as Record<string, unknown>;
}
export function parseIntegrationApplication(value: unknown) {
  const body = record(value);
  const organiserId = integrationId(body.organiserId);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 100)
    return invalid('Use 2 to 100 characters for the application name.');
  const status = body.status ?? 'active';
  if (status !== 'active' && status !== 'disabled')
    return invalid('Choose active or disabled.');
  const domains = body.domains ?? [];
  if (!Array.isArray(domains) || domains.length > 20)
    return invalid('Register no more than 20 website origins.');
  const unique = new Map<string, IntegrationDomain>();
  for (const input of domains) {
    const domain = record(input);
    const environment = integrationEnvironment(domain.environment);
    const origin = canonicalIntegrationOrigin(domain.origin, environment);
    unique.set(`${environment}:${origin}`, { environment, origin });
  }
  const eventIds = body.eventIds ?? [];
  if (!Array.isArray(eventIds) || eventIds.length > 100)
    return invalid('Select no more than 100 events.');
  return {
    organiserId,
    name,
    status,
    domains: [...unique.values()],
    eventIds: [...new Set(eventIds.map(integrationId))],
  };
}
export function parseIntegrationKey(value: unknown) {
  const body = record(value);
  const environment = integrationEnvironment(body.environment);
  const scopes = body.scopes ?? ['integration:read'];
  if (
    !Array.isArray(scopes) ||
    scopes.length > INTEGRATION_SCOPES.length ||
    scopes.some((scope) => !INTEGRATION_SCOPES.includes(scope)) ||
    new Set(scopes).size !== scopes.length
  )
    return invalid('Choose the available permissions without duplicates.');
  const expiresInDays = body.expiresInDays ?? 90;
  if (
    typeof expiresInDays !== 'number' ||
    !Number.isSafeInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 365
  )
    return invalid('Choose an expiry between 1 and 365 days.');
  return {
    environment,
    scopes: scopes as IntegrationScope[],
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
  };
}
export async function readIntegrationJson(
  request: Request,
  maximumBytes = 16_384,
) {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new IntegrationError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Send JSON with Content-Type: application/json.',
    );
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes)
    throw new IntegrationError(
      413,
      'PAYLOAD_TOO_LARGE',
      'The integration request is too large.',
    );
  const reader = request.body?.getReader();
  if (!reader) return invalid('Enter a valid JSON request.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new IntegrationError(
          413,
          'PAYLOAD_TOO_LARGE',
          'The integration request is too large.',
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    return invalid('Enter a valid JSON request.');
  } finally {
    reader.releaseLock();
  }
}
