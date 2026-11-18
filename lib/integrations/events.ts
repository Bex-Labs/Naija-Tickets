import { IntegrationError } from './errors.ts';
import {
  integrationApiHandler,
  type IntegrationApiDependencies,
  type IntegrationAuthProof,
} from './api.ts';
import type { IntegrationContext } from './types.ts';
import { INTEGRATION_ID_PATTERN } from './validation.ts';

export type EventReadOperation = 'list' | 'detail' | 'tickets' | 'availability';
export type EventReadQuery = {
  limit: number;
  city: string | null;
  category: string | null;
  startsFrom: string | null;
  startsBefore: string | null;
  afterId: string | null;
  afterStart: string | null;
  afterSort: number | null;
};
export type EventReadDependencies = {
  read(
    this: void,
    proof: IntegrationAuthProof,
    operation: EventReadOperation,
    eventId: string | null,
    query: EventReadQuery,
  ): Promise<{ rows: unknown[]; as_of: string }>;
};
const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => character.charCodeAt(0) < 32);
const invalid = (message: string): never => {
  throw new IntegrationError(400, 'INVALID_REQUEST', message);
};
const unavailable = (): never => {
  throw new IntegrationError(
    503,
    'INTEGRATIONS_UNAVAILABLE',
    'Event information is temporarily unavailable. Please try again.',
  );
};
const scopes = {
  list: 'events:read',
  detail: 'events:read',
  tickets: 'tickets:read',
  availability: 'availability:read',
} as const;
const routes = {
  list: 'events.list',
  detail: 'events.detail',
  tickets: 'events.tickets',
  availability: 'events.availability',
} as const;
const timestamp = (value: string, preservePrecision = false) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return invalid(
      'Use ISO dates with a timezone, such as 2026-10-20T00:00:00+01:00.',
    );
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
    return invalid('Enter a real calendar date.');
  // Keep PostgreSQL microseconds in keyset boundaries to avoid repeating rows.
  if (preservePrecision) return value;
  if (/\.\d{4,}/.test(value))
    return invalid(
      'Use no more than three fractional second digits in date filters.',
    );
  return new Date(value).toISOString();
};
async function cursorBinding(
  context: IntegrationContext,
  operation: EventReadOperation,
  eventId: string | null,
  query: EventReadQuery,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      context.integrationId,
      context.environment,
      operation,
      eventId,
      query.city,
      query.category,
      query.startsFrom,
      query.startsBefore,
    ]),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
}
export async function parseEventReadQuery(
  request: Request,
  context: IntegrationContext,
  operation: EventReadOperation,
  eventId: string | null,
) {
  const url = new URL(request.url);
  if (url.search.length > 2048) return invalid('The query is too long.');
  const allowed =
    operation === 'list'
      ? ['limit', 'cursor', 'city', 'category', 'starts_from', 'starts_before']
      : operation === 'tickets'
        ? ['limit', 'cursor']
        : [];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      return invalid('Use only the documented query parameters, once each.');
  }
  const limitValue = url.searchParams.get('limit');
  if (
    limitValue !== null &&
    (!/^[1-9]\d{0,2}$/.test(limitValue) || Number(limitValue) > 100)
  )
    return invalid('Choose a page size from 1 to 100.');
  const city = url.searchParams.get('city')?.trim() ?? null;
  const category = url.searchParams.get('category') ?? null;
  if (
    city !== null &&
    (city.length < 1 || city.length > 80 || hasControlCharacters(city))
  )
    return invalid('Enter a city with 1 to 80 characters.');
  if (category !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(category))
    return invalid('Use the category slug, such as concert.');
  const query: EventReadQuery = {
    limit: Number(limitValue ?? 20),
    city,
    category,
    startsFrom: url.searchParams.has('starts_from')
      ? timestamp(url.searchParams.get('starts_from')!)
      : null,
    startsBefore: url.searchParams.has('starts_before')
      ? timestamp(url.searchParams.get('starts_before')!)
      : null,
    afterId: null,
    afterStart: null,
    afterSort: null,
  };
  if (
    query.startsFrom &&
    query.startsBefore &&
    query.startsFrom >= query.startsBefore
  )
    return invalid('The end of the date range must be after its start.');
  const binding = await cursorBinding(context, operation, eventId, query);
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null) {
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
        throw Error();
      const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        !raw ||
        raw.v !== 1 ||
        raw.binding !== binding ||
        typeof raw.id !== 'string' ||
        !INTEGRATION_ID_PATTERN.test(raw.id)
      )
        throw Error();
      query.afterId = raw.id.toLowerCase();
      if (operation === 'list') query.afterStart = timestamp(raw.start, true);
      else if (
        operation === 'tickets' &&
        Number.isInteger(raw.sort) &&
        raw.sort >= -2147483648 &&
        raw.sort <= 2147483647
      )
        query.afterSort = raw.sort;
      else throw Error();
    } catch {
      return invalid(
        'The page cursor is invalid or belongs to a different query.',
      );
    }
  }
  return { query, binding };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return unavailable();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : unavailable();
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function count(value: unknown): number {
  const number =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' &&
    Number.isSafeInteger(number) &&
    number >= 0
    ? number
    : unavailable();
}
function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : unavailable();
}
function publicImage(value: unknown) {
  if (value === null || value === '') return null;
  const path = text(value);
  if (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !hasControlCharacters(path) &&
    !path.includes('\\')
  )
    return path;
  try {
    const url = new URL(path);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function projectIntegrationEvent(value: unknown) {
  const row = record(value),
    organiser = record(row.organiser),
    category = record(row.category);
  return {
    id: text(row.id),
    title: text(row.title),
    slug: text(row.slug),
    description: text(row.description),
    image_url: publicImage(row.image_url),
    venue: {
      name: text(row.venue_name),
      address: text(row.address),
      city: text(row.city),
      state: text(row.state),
    },
    starts_at: text(row.starts_at),
    ends_at: text(row.ends_at),
    timezone: text(row.timezone),
    sales_start_at: nullableText(row.sales_start_at),
    sales_end_at: nullableText(row.sales_end_at),
    organiser: {
      id: text(organiser.id),
      name: text(organiser.name),
      verified: bool(organiser.verified),
    },
    category: {
      id: text(category.id),
      name: text(category.name),
      slug: text(category.slug),
    },
  };
}
export function projectIntegrationTicket(value: unknown) {
  const row = record(value);
  const price = count(row.price_kobo),
    standard = count(row.standard_price_kobo);
  const early =
    row.early_bird_price_kobo === null
      ? null
      : count(row.early_bird_price_kobo);
  if (
    !['open', 'upcoming', 'closed', 'sold_out', 'allocation_limited'].includes(
      text(row.sale_status),
    ) ||
    !['standard', 'early_bird'].includes(text(row.price_kind))
  )
    return unavailable();
  return {
    id: text(row.id),
    event_id: text(row.event_id),
    name: text(row.name),
    description: nullableText(row.description),
    currency: 'NGN' as const,
    price_kobo: price,
    standard_price_kobo: standard,
    price_kind: text(row.price_kind),
    early_bird_price_kobo: early,
    early_bird_ends_at: nullableText(row.early_bird_ends_at),
    admissions_per_ticket: count(row.admissions_per_ticket),
    min_packages_per_order: count(row.min_packages_per_order),
    max_packages_per_order: count(row.max_packages_per_order),
    sales_start_at: nullableText(row.sales_start_at),
    sales_end_at: nullableText(row.sales_end_at),
    sale_status: text(row.sale_status),
    fees_included: false,
    promo_discount_included: false,
  };
}
export function projectIntegrationAvailability(value: unknown) {
  const row = record(value);
  if (!Array.isArray(row.ticket_types)) return unavailable();
  return {
    event_id: text(row.event_id),
    as_of: text(row.as_of),
    advisory: true,
    total_admissions: count(row.total_admissions),
    sold_admissions: count(row.sold_admissions),
    reserved_admissions: count(row.reserved_admissions),
    remaining_admissions: count(row.remaining_admissions),
    ticket_types: row.ticket_types.map((value) => {
      const item = record(value);
      return {
        ticket_type_id: text(item.ticket_type_id),
        admissions_per_ticket: count(item.admissions_per_ticket),
        total_admissions: count(item.total_admissions),
        sold_admissions: count(item.sold_admissions),
        reserved_admissions: count(item.reserved_admissions),
        remaining_admissions: count(item.remaining_admissions),
        remaining_packages: count(item.remaining_packages),
        early_bird_remaining_packages:
          item.early_bird_remaining_packages === null
            ? null
            : count(item.early_bird_remaining_packages),
        max_packages_at_current_price: count(
          item.max_packages_at_current_price,
        ),
        sale_status: text(item.sale_status),
      };
    }),
  };
}
export function integrationEventHandler(
  api: IntegrationApiDependencies,
  resources: EventReadDependencies,
  operation: EventReadOperation,
  eventId: string | null = null,
) {
  return integrationApiHandler(
    api,
    scopes[operation],
    routes[operation],
    async (context, request, proof) => {
      if (
        operation !== 'list' &&
        (!eventId || !INTEGRATION_ID_PATTERN.test(eventId))
      )
        throw new IntegrationError(404, 'NOT_FOUND', 'Event not found.');
      const { query, binding } = await parseEventReadQuery(
        request,
        context,
        operation,
        eventId,
      );
      const result = await resources.read(proof, operation, eventId, query);
      if (
        !result ||
        !Array.isArray(result.rows) ||
        typeof result.as_of !== 'string'
      )
        return unavailable();
      if (operation === 'detail' || operation === 'availability') {
        if (!result.rows.length)
          throw new IntegrationError(404, 'NOT_FOUND', 'Event not found.');
        return operation === 'detail'
          ? projectIntegrationEvent(result.rows[0])
          : projectIntegrationAvailability(result.rows[0]);
      }
      const page = result.rows.slice(0, query.limit);
      const last = page.length ? record(page[page.length - 1]) : null;
      const nextCursor =
        result.rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                binding,
                id: text(last.id),
                ...(operation === 'list'
                  ? { start: text(last.starts_at) }
                  : { sort: last.sort_order }),
              }),
            ).toString('base64url')
          : null;
      return {
        data:
          operation === 'list'
            ? page.map(projectIntegrationEvent)
            : page.map(projectIntegrationTicket),
        meta: { next_cursor: nextCursor },
      };
    },
    operation === 'list' || operation === 'tickets',
  );
}
