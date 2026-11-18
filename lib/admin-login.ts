import { IntegrationError } from './integrations/errors.ts';
import { credentialDigest } from './integrations/keys.ts';
import {
  enforceIntegrationLimit,
  type IntegrationApiDependencies,
} from './integrations/api.ts';
export async function limitAdminSignIn(
  request: Request,
  username: string,
  deps: Pick<IntegrationApiDependencies, 'limit' | 'trustedIp'>,
) {
  await enforceIntegrationLimit(deps, 'admin-login:global', 20);
  const ip = deps.trustedIp?.(request);
  if (ip)
    await enforceIntegrationLimit(
      deps,
      'admin-login:ip:' + (await credentialDigest(ip)),
      8,
    );
  await enforceIntegrationLimit(
    deps,
    'admin-login:account:' +
      (await credentialDigest(username.trim().toLowerCase())),
    8,
  );
}
export function parseAdminSignIn(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Enter your administrator login ID and password.',
    );
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((k) => !['username', 'password'].includes(k)) ||
    typeof row.username !== 'string' ||
    typeof row.password !== 'string' ||
    row.username.trim().length < 1 ||
    row.username.length > 80 ||
    row.password.length < 1 ||
    row.password.length > 1024
  )
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Enter your administrator login ID and password.',
    );
  return { username: row.username, password: row.password };
}
