import { IntegrationError } from './errors.ts';
import { credentialDigest, parseIntegrationCredential } from './keys.ts';
import type { IntegrationContext, IntegrationScope } from './types.ts';
export type IntegrationAuthProof = {
  keyId: string;
  digest: string;
  environment: 'test' | 'live';
};
export type IntegrationRoute =
  | 'integration.introspect'
  | 'api.not_found'
  | 'events.list'
  | 'events.detail'
  | 'events.tickets'
  | 'events.availability'
  | 'checkout.create'
  | 'checkout.status'
  | 'external_events.upsert'
  | 'advanced.orders'
  | 'advanced.order'
  | 'advanced.tickets'
  | 'advanced.ticket'
  | 'advanced.attendees'
  | 'advanced.groups'
  | 'advanced.refunds'
  | 'advanced.sales'
  | 'advanced.entry';
export type IntegrationResult = {
  data: unknown;
  meta: { next_cursor: string | null };
};
export type IntegrationRateResult = { allowed: boolean; retryAfter: number };
export type IntegrationApiDependencies = {
  authenticate(
    id: string,
    digest: string,
    environment: string,
  ): Promise<IntegrationContext | null>;
  limit(bucket: string, maximum: number): Promise<IntegrationRateResult>;
  record?(input: {
    requestId: string;
    keyId: string;
    route: string;
    status: number;
    errorCode: string | null;
    durationMs: number;
  }): Promise<void>;
  log?(input: Record<string, string | number | null>): void;
  trustedIp?(request: Request): string | null;
};
export function integrationResponse(
  requestId: string,
  data: unknown,
  error?: IntegrationError,
  meta?: { next_cursor: string | null },
) {
  const headers: Record<string, string> = {
    'X-Request-ID': requestId,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Authorization, Origin',
  };
  if (error?.retryAfter) headers['Retry-After'] = String(error.retryAfter);
  if (error?.status === 405) headers.Allow = 'GET';
  if (error?.status === 401)
    headers['WWW-Authenticate'] = 'Bearer realm="Naija Tickets API"';
  return Response.json(
    error
      ? {
          error: {
            code: error.code,
            message: error.message,
            request_id: requestId,
          },
        }
      : { data, meta: { request_id: requestId, ...meta } },
    { status: error?.status ?? 200, headers },
  );
}
export async function enforceIntegrationLimit(
  deps: Pick<IntegrationApiDependencies, 'limit'>,
  bucket: string,
  maximum: number,
) {
  const result = await deps.limit(bucket, maximum);
  if (!result.allowed)
    throw new IntegrationError(
      429,
      'RATE_LIMITED',
      'Too many requests. Try again shortly.',
      Math.max(1, result.retryAfter),
    );
}
export function integrationApiHandler(
  deps: IntegrationApiDependencies,
  scope: IntegrationScope,
  route: IntegrationRoute,
  handler: (
    context: IntegrationContext,
    request: Request,
    proof: IntegrationAuthProof,
  ) => unknown,
  paginated = false,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
) {
  return async (request: Request) => {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    let context: IntegrationContext | null = null;
    let error: IntegrationError | undefined;
    let data: unknown;
    let meta: { next_cursor: string | null } | undefined;
    try {
      await enforceIntegrationLimit(deps, 'global:v1', 600);
      const ip = deps.trustedIp?.(request);
      if (ip)
        await enforceIntegrationLimit(
          deps,
          `ip:${await credentialDigest(ip)}`,
          60,
        );
      if (request.headers.has('origin'))
        throw new IntegrationError(
          403,
          'BROWSER_ACCESS_DISABLED',
          'Secret API credentials are for server-to-server requests only.',
        );
      if (request.method !== method)
        throw new IntegrationError(
          405,
          'METHOD_NOT_ALLOWED',
          `Use ${method} for this endpoint.`,
        );
      const authorization = request.headers.get('authorization');
      const credential = authorization?.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;
      const parsed = parseIntegrationCredential(credential);
      if (!parsed || !credential)
        throw new IntegrationError(
          401,
          'INVALID_API_KEY',
          'Provide a valid, active API key.',
        );
      const digest = await credentialDigest(credential);
      context = await deps.authenticate(parsed.id, digest, parsed.environment);
      if (!context)
        throw new IntegrationError(
          401,
          'INVALID_API_KEY',
          'Provide a valid, active API key.',
        );
      await enforceIntegrationLimit(deps, `key:${context.keyId}`, 60);
      await enforceIntegrationLimit(
        deps,
        `integration:${context.integrationId}`,
        180,
      );
      await enforceIntegrationLimit(
        deps,
        `organiser:${context.organiserId}`,
        300,
      );
      if (!context.scopes.includes(scope))
        throw new IntegrationError(
          403,
          'INSUFFICIENT_SCOPE',
          `This operation requires ${scope}.`,
        );
      const result = await handler(context, request, {
        keyId: parsed.id,
        digest,
        environment: parsed.environment,
      });
      if (paginated) {
        const page = result as IntegrationResult;
        data = page.data;
        meta = page.meta;
      } else data = result;
    } catch (cause) {
      error =
        cause instanceof IntegrationError
          ? cause
          : new IntegrationError(
              503,
              'INTEGRATIONS_UNAVAILABLE',
              'Integrations are temporarily unavailable. Please try again.',
            );
    }
    const status = error?.status ?? 200;
    const durationMs = Math.min(
      3600000,
      Math.max(0, Math.round(performance.now() - started)),
    );
    const metadata = {
      request_id: requestId,
      integration_id: context?.integrationId ?? null,
      key_id: context?.keyId ?? null,
      route,
      status,
      duration_ms: durationMs,
      error_code: error?.code ?? null,
    };
    deps.log?.(metadata);
    if (context && deps.record) {
      try {
        await deps.record({
          requestId,
          keyId: context.keyId,
          route,
          status,
          errorCode: error?.code ?? null,
          durationMs,
        });
      } catch {
        deps.log?.({
          request_id: requestId,
          route,
          status,
          error_code: 'USAGE_LOG_UNAVAILABLE',
        });
      }
    }
    const response = integrationResponse(requestId, data, error, meta);
    if (error?.status === 405) response.headers.set('Allow', method);
    return response;
  };
}
export function integrationIntrospection(context: IntegrationContext) {
  return {
    id: context.integrationId,
    name: context.name,
    organiser_id: context.organiserId,
    environment: context.environment,
    scopes: context.scopes,
    key_id: context.keyId,
    expires_at: context.expiresAt,
    capabilities: {
      introspection: true,
      event_api: context.environment === 'live',
      hosted_checkout: false,
      widget: false,
      sandbox_purchases: false,
    },
  };
}
