import { isIP } from 'node:net';
import {
  getSupabaseAdminClient,
  getAuthenticatedUser,
} from '@/lib/supabase/server';
import { IntegrationError, integrationDatabaseError } from './errors.ts';
import {
  enforceIntegrationLimit,
  integrationResponse,
  type IntegrationApiDependencies,
  type IntegrationRateResult,
} from './api.ts';
import type { IntegrationContext } from './types.ts';

export async function integrationRpc<T>(
  name: string,
  parameters: Record<string, unknown>,
  mapError: (error: unknown) => IntegrationError = integrationDatabaseError,
): Promise<T> {
  try {
    const { data, error } = await getSupabaseAdminClient()
      .rpc(name, parameters)
      .abortSignal(AbortSignal.timeout(8000));
    if (error) throw mapError(error);
    return data as T;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw mapError(error);
  }
}
export const integrationApiDependencies: IntegrationApiDependencies = {
  authenticate: (id, digest, environment) =>
    integrationRpc<IntegrationContext | null>('authenticate_integration_key', {
      p_key_id: id,
      p_digest: digest,
      p_environment: environment,
    }),
  async limit(bucket, maximum) {
    const result = await integrationRpc<IntegrationRateResult>(
      'consume_integration_rate_limit',
      { p_bucket: bucket, p_limit: maximum, p_window_seconds: 60 },
    );
    if (
      !result ||
      typeof result.allowed !== 'boolean' ||
      !Number.isSafeInteger(result.retryAfter) ||
      result.retryAfter < 1
    )
      throw new IntegrationError(
        503,
        'INTEGRATIONS_UNAVAILABLE',
        'API limits are temporarily unavailable.',
      );
    return result;
  },
  record: (input) =>
    integrationRpc<void>('record_integration_request', {
      p_request_id: input.requestId,
      p_key_id: input.keyId,
      p_route: input.route,
      p_status: input.status,
      p_error_code: input.errorCode,
      p_duration_ms: input.durationMs,
    }),
  log: (input) => console.info('integration_api', JSON.stringify(input)),
  trustedIp(request) {
    // Vercel overwrites this header. Never trust client forwarding headers on
    // local/other deployments; the global pre-auth budget remains in effect.
    if (process.env.VERCEL !== '1') return null;
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return ip && isIP(ip) ? ip : null;
  },
};
export function organiserIntegrationHandler(
  handler: (request: Request, userId: string) => Promise<unknown>,
) {
  return async (request: Request) => {
    const requestId = crypto.randomUUID();
    try {
      await enforceIntegrationLimit(
        integrationApiDependencies,
        'global:v1',
        600,
      );
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin)
        throw new IntegrationError(
          403,
          'INVALID_ORIGIN',
          'Use the Naija Tickets organiser dashboard to manage integrations.',
        );
      const bearer = request.headers.get('authorization');
      if (bearer?.startsWith('Bearer nt_'))
        throw new IntegrationError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Sign in with your organiser account to manage integrations.',
        );
      const user = await getAuthenticatedUser(request);
      if (!user)
        throw new IntegrationError(
          401,
          'AUTHENTICATION_REQUIRED',
          'Sign in with your organiser account to manage integrations.',
        );
      if (!user.email_confirmed_at)
        throw new IntegrationError(
          403,
          'EMAIL_CONFIRMATION_REQUIRED',
          'Confirm your account email before creating developer credentials.',
        );
      await enforceIntegrationLimit(
        integrationApiDependencies,
        `dashboard:${user.id}`,
        30,
      );
      return integrationResponse(requestId, await handler(request, user.id));
    } catch (cause) {
      const error =
        cause instanceof IntegrationError
          ? cause
          : integrationDatabaseError(cause);
      console.info(
        'integration_management',
        JSON.stringify({
          request_id: requestId,
          status: error.status,
          error_code: error.code,
        }),
      );
      return integrationResponse(requestId, null, error);
    }
  };
}
