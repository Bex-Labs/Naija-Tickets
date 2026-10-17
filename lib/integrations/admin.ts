import { IntegrationError } from './errors.ts';
import { integrationId, readIntegrationJson } from './validation.ts';
import type {
  AdminIntegrationOverview,
  AdminIntegrationActivity,
  AdminIntegrationRow,
} from './admin-types.ts';
export type IntegrationOversightDependencies = {
  authenticate(): Promise<{ id: string; username: string } | null>;
  verifyPassword(username: string, password: string): Promise<boolean>;
  overview(
    search: string,
    status: string,
    after: string | null,
  ): Promise<unknown>;
  activity(app: string, before: string | null): Promise<unknown>;
  decide(
    app: string,
    admin: string,
    suspend: boolean,
    reason: string,
  ): Promise<void>;
  limit(admin: string): Promise<void>;
};
const row = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid projection');
  return value as Record<string, unknown>;
};
const text = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Invalid text');
  return value;
};
const nullable = (value: unknown) => (value === null ? null : text(value));
const number = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid count');
  return value;
};
export function projectAdminOverview(value: unknown): AdminIntegrationOverview {
  const data = row(value),
    totals = row(data.totals);
  if (
    !Array.isArray(data.applications) ||
    data.applications.length > 21 ||
    !['live', 'test'].includes(text(data.resourceMode))
  )
    throw new Error('Invalid overview');
  const applications = data.applications.slice(0, 20).map((v) => {
    const a = row(v);
    if (!['active', 'disabled'].includes(text(a.status)))
      throw new Error('Invalid status');
    return {
      id: text(a.id),
      name: text(a.name),
      organiserId: text(a.organiserId),
      organiserName: text(a.organiserName),
      status: a.status,
      suspendedAt: nullable(a.suspendedAt),
      suspensionReason: nullable(a.suspensionReason),
      createdAt: text(a.createdAt),
      activeKeys: number(a.activeKeys),
      assignedEvents: number(a.assignedEvents),
      requests24h: number(a.requests24h),
      errors24h: number(a.errors24h),
      pendingDeliveries: number(a.pendingDeliveries),
      exhaustedDeliveries: number(a.exhaustedDeliveries),
    } as AdminIntegrationRow;
  });
  return {
    applications,
    totals: {
      applications: number(totals.applications),
      suspended: number(totals.suspended),
      requests24h: number(totals.requests24h),
      errors24h: number(totals.errors24h),
      exhaustedDeliveries: number(totals.exhaustedDeliveries),
    },
    resourceMode: data.resourceMode as 'test' | 'live',
    asOf: text(data.asOf),
    nextCursor: data.applications.length > 20 ? applications[19].id : null,
  };
}
export function projectAdminActivity(value: unknown): AdminIntegrationActivity {
  const data = row(value);
  if (
    !Array.isArray(data.requests) ||
    data.requests.length > 21 ||
    !Array.isArray(data.audit) ||
    data.audit.length > 20
  )
    throw new Error('Invalid activity');
  const requests = data.requests.slice(0, 20).map((v) => {
    const r = row(v);
    return {
      id: text(r.id),
      keyId: text(r.keyId),
      route: text(r.route),
      status: number(r.status),
      errorCode: nullable(r.errorCode),
      durationMs: number(r.durationMs),
      createdAt: text(r.createdAt),
    };
  });
  const audit = data.audit.map((v) => {
    const a = row(v);
    return {
      id: text(a.id),
      action: text(a.action),
      createdAt: text(a.createdAt),
      actorId: nullable(a.actorId),
      adminActorId: nullable(a.adminActorId),
      environment: nullable(a.environment),
      keyId: nullable(a.keyId),
      endpointId: nullable(a.endpointId),
      outcome: nullable(a.outcome),
    };
  });
  return {
    requests,
    audit,
    nextCursor: data.requests.length > 20 ? requests[19].id : null,
  };
}
export function adminIntegrationsHandler(
  deps: IntegrationOversightDependencies,
  appId?: string,
) {
  return async (request: Request) => {
    const requestId = crypto.randomUUID(),
      headers = {
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Request-ID': requestId,
        Vary: 'Cookie',
      };
    try {
      if (request.headers.has('authorization'))
        throw new IntegrationError(
          401,
          'ADMIN_REQUIRED',
          'Administrator sign-in required.',
        );
      const admin = await deps.authenticate();
      if (!admin)
        throw new IntegrationError(
          401,
          'ADMIN_REQUIRED',
          'Administrator sign-in required.',
        );
      if (request.method !== 'GET' && request.method !== 'PATCH')
        throw new IntegrationError(
          405,
          'METHOD_NOT_ALLOWED',
          'Use GET or PATCH.',
        );
      await deps.limit(admin.id);
      const url = new URL(request.url),
        params = url.searchParams;
      if (request.method === 'PATCH') {
        if (
          !appId ||
          url.search ||
          request.headers.get('origin') !== url.origin
        )
          throw new IntegrationError(
            403,
            'INVALID_ORIGIN',
            'Use the private administration page.',
          );
        const body = await readIntegrationJson(request, 4096);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new IntegrationError(
            400,
            'INVALID_REQUEST',
            'Enter a review reason and your current password.',
          );
        const input = row(body);
        if (
          Object.keys(input).some(
            (k) => !['action', 'reason', 'password'].includes(k),
          ) ||
          !['suspend', 'restore'].includes(String(input.action)) ||
          typeof input.reason !== 'string' ||
          input.reason.trim().length < 5 ||
          input.reason.trim().length > 240 ||
          typeof input.password !== 'string' ||
          input.password.length < 1 ||
          input.password.length > 1024
        )
          throw new IntegrationError(
            400,
            'INVALID_REQUEST',
            'Enter a review reason and your current password.',
          );
        if (!(await deps.verifyPassword(admin.username, input.password)))
          throw new IntegrationError(
            403,
            'PASSWORD_REQUIRED',
            'Your current administrator password is incorrect.',
          );
        await deps.decide(
          integrationId(appId),
          admin.id,
          input.action === 'suspend',
          input.reason.trim(),
        );
        return Response.json(
          { data: { ok: true }, meta: { request_id: requestId } },
          { headers },
        );
      }
      const allowed = appId ? ['before'] : ['search', 'status', 'after'];
      if (
        [...params.keys()].some(
          (k) => !allowed.includes(k) || params.getAll(k).length !== 1,
        )
      )
        throw new IntegrationError(
          400,
          'INVALID_REQUEST',
          'Use the documented filters.',
        );
      let data;
      if (appId)
        data = projectAdminActivity(
          await deps.activity(
            integrationId(appId),
            params.has('before') ? integrationId(params.get('before')) : null,
          ),
        );
      else {
        const search = (params.get('search') || '').trim(),
          status = params.get('status') || 'all';
        if (
          search.length > 80 ||
          !['all', 'active', 'disabled', 'suspended'].includes(status)
        )
          throw new IntegrationError(
            400,
            'INVALID_REQUEST',
            'Choose a valid application filter.',
          );
        data = projectAdminOverview(
          await deps.overview(
            search,
            status,
            params.has('after') ? integrationId(params.get('after')) : null,
          ),
        );
      }
      return Response.json(
        { data, meta: { request_id: requestId } },
        { headers },
      );
    } catch (cause) {
      const error =
        cause instanceof IntegrationError
          ? cause
          : new IntegrationError(
              503,
              'OVERSIGHT_UNAVAILABLE',
              'Integration oversight is temporarily unavailable.',
            );
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            request_id: requestId,
          },
        },
        {
          status: error.status,
          headers: {
            ...headers,
            ...(error.status === 405 ? { Allow: 'GET, PATCH' } : {}),
            ...(error.retryAfter
              ? { 'Retry-After': String(error.retryAfter) }
              : {}),
          },
        },
      );
    }
  };
}
