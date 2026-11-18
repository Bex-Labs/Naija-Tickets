import { requireIntegrationResourceMode } from './resource-mode.ts';
import { IntegrationError, integrationDatabaseError } from './errors.ts';
import { credentialDigest } from './keys.ts';
import { integrationId, readIntegrationJson } from './validation.ts';
import { checkoutIdempotencyKey } from './checkout-sessions.ts';
import {
  integrationApiHandler,
  enforceIntegrationLimit,
  type IntegrationApiDependencies,
  type IntegrationAuthProof,
} from './api.ts';
import type { IntegrationContext, IntegrationScope } from './types.ts';
export const OPERATION_SCOPES = {
  orders: 'orders:read',
  order: 'orders:read',
  tickets: 'tickets:status',
  ticket: 'tickets:status',
  attendees: 'attendees:read',
  groups: 'groups:read',
  refunds: 'refunds:read',
  sales: 'sales:read',
} as const satisfies Record<string, IntegrationScope>;
export type AdvancedOperation = keyof typeof OPERATION_SCOPES;
export type AdvancedQuery = {
  eventId: string | null;
  resourceId: string | null;
  limit: number;
  after: string | null;
};
export type OperationsDependencies = {
  requireConfiguration(
    context: IntegrationContext,
    entry: boolean,
  ): Promise<void>;
  read(
    proof: IntegrationAuthProof,
    operation: AdvancedOperation,
    query: AdvancedQuery,
  ): Promise<{ rows: unknown[] }>;
  entry(
    proof: IntegrationAuthProof,
    input: {
      eventId: string;
      code: string;
      admit: boolean;
      idempotencyDigest: string;
      payloadHash: string;
    },
  ): Promise<unknown>;
};
const invalid = (): never => {
  throw new IntegrationError(
    400,
    'INVALID_REQUEST',
    'Use only the documented identifiers, pagination or entry fields.',
  );
};
const unavailable = (): never => {
  throw new IntegrationError(
    503,
    'INTEGRATIONS_UNAVAILABLE',
    'Operation information is temporarily unavailable.',
  );
};
const object = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return unavailable();
  return value as Record<string, unknown>;
};
const text = (value: unknown) =>
  typeof value === 'string' ? value : unavailable();
const nullableText = (value: unknown) => (value === null ? null : text(value));
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : unavailable();
const money = (value: unknown) => (value === null ? null : count(value));
const bool = (value: unknown) =>
  typeof value === 'boolean' ? value : unavailable();
const choice = (value: unknown, options: string[]) =>
  typeof value === 'string' && options.includes(value) ? value : unavailable();
const orderStates = [
  'pending',
  'paid',
  'failed',
  'expired',
  'abandoned',
  'refunded',
  'partially_refunded',
];
const ticketStates = ['valid', 'used', 'cancelled', 'refunded'];
const claimStates = ['UNCLAIMED', 'CLAIMED', 'CHECKED_IN'];
/** Explicit field projection is also a defence against an accidentally widened RPC. */
export function projectOperation(
  operation: AdvancedOperation,
  value: unknown,
  contacts = false,
) {
  const row = object(value);
  switch (operation) {
    case 'orders':
    case 'order':
      return {
        id: text(row.id),
        event_id: text(row.event_id),
        checkout_session_id: text(row.checkout_session_id),
        status: choice(row.status, orderStates),
        currency: choice(row.currency, ['NGN']),
        subtotal_kobo: count(row.subtotal_kobo),
        discount_kobo: count(row.discount_kobo),
        fee_kobo: count(row.fee_kobo),
        total_kobo: count(row.total_kobo),
        created_at: text(row.created_at),
        paid_at: nullableText(row.paid_at),
        payment_status: choice(row.payment_status, [
          'verified',
          'refunded',
          'unverified',
        ]),
        admissions: count(row.admissions),
      };
    case 'tickets':
    case 'ticket':
      return {
        id: text(row.id),
        event_id: text(row.event_id),
        order_id: text(row.order_id),
        ticket_type_id: text(row.ticket_type_id),
        group_booking_id: nullableText(row.group_booking_id),
        status: choice(row.status, ticketStates),
        claim_state: choice(row.claim_state, claimStates),
        issued_at: text(row.issued_at),
        claimed_at: nullableText(row.claimed_at),
        checked_in_at: nullableText(row.checked_in_at),
        admission_limit: count(row.admission_limit),
        admissions_used: count(row.admissions_used),
        usable_for_entry: bool(row.usable_for_entry),
      };
    case 'attendees': {
      const erased = bool(row.personal_data_erased);
      return {
        ticket_id: text(row.ticket_id),
        order_id: text(row.order_id),
        event_id: text(row.event_id),
        group_booking_id: nullableText(row.group_booking_id),
        claim_state: choice(row.claim_state, ['CLAIMED', 'CHECKED_IN']),
        ticket_status: choice(row.ticket_status, ticketStates),
        personal_data_erased: erased,
        name: erased ? null : nullableText(row.name),
        ...(contacts
          ? {
              email: erased ? null : nullableText(row.email),
              phone: erased ? null : nullableText(row.phone),
            }
          : {}),
      };
    }
    case 'groups':
      return {
        id: text(row.id),
        order_id: text(row.order_id),
        event_id: text(row.event_id),
        ticket_type_id: text(row.ticket_type_id),
        admissions: count(row.admissions),
        registered_admissions: count(row.registered_admissions),
        unclaimed_admissions: count(row.unclaimed_admissions),
        checked_in_admissions: count(row.checked_in_admissions),
        claimable_admissions: count(row.claimable_admissions),
      };
    case 'refunds':
      return {
        id: text(row.id),
        order_id: text(row.order_id),
        currency: choice(row.currency, ['NGN']),
        status: choice(row.status, [
          'requested',
          'approved',
          'rejected',
          'processing',
          'completed',
          'failed',
        ]),
        amount_kobo: money(row.amount_kobo),
        created_at: text(row.created_at),
        confirmed_at: nullableText(row.confirmed_at),
      };
    case 'sales':
      return {
        event_id: nullableText(row.event_id),
        currency: choice(row.currency, ['NGN']),
        verified_orders: count(row.verified_orders),
        ticket_subtotal_kobo: count(row.ticket_subtotal_kobo),
        service_fees_charged_kobo: count(row.service_fees_charged_kobo),
        customer_payments_kobo: count(row.customer_payments_kobo),
        completed_refunds_kobo: count(row.completed_refunds_kobo),
        net_customer_payments_kobo: count(row.net_customer_payments_kobo),
        sold_admissions: count(row.sold_admissions),
        as_of: text(row.as_of),
        application_attributed_only:
          row.application_attributed_only === true ? true : unavailable(),
      };
  }
}
export function projectEntry(value: unknown) {
  const row = object(value);
  return {
    ticket_id: text(row.ticket_id),
    event_id: text(row.event_id),
    outcome: choice(row.outcome, [
      'valid',
      'admitted',
      'already_used',
      'cancelled',
      'refunded',
      'unpaid',
      'invalid',
      'event_unavailable',
    ]),
    admitted: bool(row.admitted),
    admission_limit: count(row.admission_limit),
    admissions_used: count(row.admissions_used),
    checked_in_at: nullableText(row.checked_in_at),
    replayed: bool(row.replayed),
  };
}
export async function parseAdvancedQuery(
  request: Request,
  context: IntegrationContext,
  operation: AdvancedOperation,
  resourceId: string | null,
) {
  const params = new URL(request.url).searchParams;
  const paginated = !['order', 'ticket', 'sales'].includes(operation);
  const allowed = [
    ...(operation === 'orders' || operation === 'sales' ? ['event_id'] : []),
    ...(paginated ? ['limit', 'cursor'] : []),
  ];
  if (
    new URL(request.url).search.length > 2048 ||
    [...params.keys()].some(
      (k) => !allowed.includes(k) || params.getAll(k).length !== 1,
    )
  )
    return invalid();
  const size = params.get('limit');
  if (size !== null && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(size))
    return invalid();
  const eventId =
    operation === 'attendees'
      ? integrationId(resourceId)
      : params.has('event_id')
        ? integrationId(params.get('event_id'))
        : null;
  const resource =
    resourceId && operation !== 'attendees' ? integrationId(resourceId) : null;
  const binding = await credentialDigest(
    JSON.stringify([
      context.integrationId,
      context.environment,
      context.scopes.slice().sort(),
      operation,
      eventId,
      resource,
    ]),
  );
  let after: string | null = null;
  if (params.has('cursor')) {
    const cursor = params.get('cursor')!;
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        return invalid();
      const row = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (row?.v !== 1 || row.binding !== binding) return invalid();
      after = integrationId(row.id);
    } catch {
      return invalid();
    }
  }
  return {
    query: { eventId, resourceId: resource, limit: Number(size || 20), after },
    binding,
    paginated,
  };
}
export function advancedReadHandler(
  api: IntegrationApiDependencies,
  deps: OperationsDependencies,
  operation: AdvancedOperation,
  resourceId: string | null = null,
) {
  return integrationApiHandler(
    api,
    OPERATION_SCOPES[operation],
    `advanced.${operation}`,
    async (context, request, proof) => {
      await deps.requireConfiguration(context, false);
      const { query, binding, paginated } = await parseAdvancedQuery(
        request,
        context,
        operation,
        resourceId,
      );
      const result = await deps.read(proof, operation, query);
      if (
        !result ||
        !Array.isArray(result.rows) ||
        result.rows.length > query.limit + 1
      )
        return unavailable();
      const rows = result.rows
        .slice(0, query.limit)
        .map((row) =>
          projectOperation(
            operation,
            row,
            context.scopes.includes('attendees:contact'),
          ),
        );
      if (!paginated) {
        if (rows.length !== 1)
          throw new IntegrationError(404, 'NOT_FOUND', 'Resource not found.');
        return rows[0];
      }
      const last =
        result.rows.length > query.limit
          ? object(result.rows[query.limit - 1])
          : null;
      return {
        data: rows,
        meta: {
          next_cursor: last
            ? Buffer.from(
                JSON.stringify({
                  v: 1,
                  binding,
                  id:
                    operation === 'attendees'
                      ? text(last.ticket_id)
                      : text(last.id),
                }),
              ).toString('base64url')
            : null,
        },
      };
    },
    !['order', 'ticket', 'sales'].includes(operation),
  );
}
export function entryOperationHandler(
  api: IntegrationApiDependencies,
  deps: OperationsDependencies,
  eventId: string,
) {
  // The action selects one of two distinct scopes only after normal server-key
  // authentication; the SQL adapter repeats that check under its authority locks.
  return integrationApiHandler(
    api,
    'entry:verify',
    'advanced.entry',
    async (context, request, proof) =>
      entryBody(api, deps, context, request, proof, eventId),
    false,
    'POST',
  );
}
async function entryBody(
  api: IntegrationApiDependencies,
  deps: OperationsDependencies,
  context: IntegrationContext,
  request: Request,
  proof: IntegrationAuthProof,
  eventId: string,
) {
  await deps.requireConfiguration(context, true);
  if (new URL(request.url).search) return invalid();
  const value = await readIntegrationJson(request, 4096);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((k) => !['code', 'action'].includes(k)) ||
    typeof row.code !== 'string' ||
    row.code.length > 30 ||
    !/^NT-[A-F0-9]{12}$/.test(row.code.trim().toUpperCase()) ||
    !['verify', 'admit'].includes(String(row.action))
  )
    return invalid();
  const admit = row.action === 'admit';
  if (admit && !context.scopes.includes('entry:check-in'))
    throw new IntegrationError(
      403,
      'INSUFFICIENT_SCOPE',
      'This operation requires entry:check-in.',
    );
  await enforceIntegrationLimit(api, `entry:key:${context.keyId}`, 30);
  await enforceIntegrationLimit(api, `entry:org:${context.organiserId}`, 120);
  const normalized = {
    eventId: integrationId(eventId),
    code: row.code.trim().toUpperCase(),
    admit,
  };
  return projectEntry(
    await deps.entry(proof, {
      ...normalized,
      idempotencyDigest: await credentialDigest(
        checkoutIdempotencyKey(request),
      ),
      payloadHash: await credentialDigest(JSON.stringify(normalized)),
    }),
  );
}
export function requireAdvancedConfiguration(
  context: Pick<IntegrationContext, 'environment'>,
  entry: boolean,
  settings: Record<string, string | undefined>,
) {
  if (
    settings.INTEGRATIONS_ADVANCED_ENABLED !== 'true' ||
    (entry && settings.INTEGRATIONS_ENTRY_ENABLED !== 'true')
  )
    throw new IntegrationError(
      503,
      'OPERATIONS_DISABLED',
      'Advanced operations have not been enabled for this deployment.',
    );
  requireIntegrationResourceMode(context.environment, settings);
}

export function operationDatabaseError(cause: unknown): IntegrationError {
  const row =
    cause && typeof cause === 'object'
      ? (cause as Record<string, unknown>)
      : {};
  if (row.code === 'NT404')
    return new IntegrationError(404, 'NOT_FOUND', 'Resource not found.');
  if (row.code === 'NT400')
    return new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Check the documented identifiers, pagination and entry fields.',
    );
  if (row.code === 'NT409')
    return row.message === 'Entry idempotency conflict.'
      ? new IntegrationError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used for a different entry request.',
        )
      : new IntegrationError(
          409,
          'OPERATION_CONFLICT',
          'This operation conflicts with its current state or retained entry history limit.',
        );
  if (row.code === 'NT410')
    return new IntegrationError(
      410,
      'ENTRY_REPLAY_EXPIRED',
      'This entry replay has expired. Verify the current ticket state with a new request.',
    );
  if (row.code === 'NT403')
    return new IntegrationError(
      403,
      'INSUFFICIENT_SCOPE',
      'This key does not have the required operation permission.',
    );
  if (row.code === '42501')
    return new IntegrationError(
      403,
      'FORBIDDEN',
      'The key creator is not authorised for this event.',
    );
  return integrationDatabaseError(cause);
}
