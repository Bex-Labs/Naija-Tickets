export type Attendee = {
  id: string;
  attendee_name: string;
  attendee_email: string;
  display_code: string;
  status: string;
  issued_at: string;
  ticketType: string;
};

export const attendeePageSize = 50;
export const attendeeStatuses = [
  'valid',
  'used',
  'cancelled',
  'refunded',
] as const;
export const attendeeSearchFields = [
  'attendee_name',
  'attendee_email',
  'display_code',
] as const;

export function parseAttendeeQuery(params: URLSearchParams) {
  const eventId = params.get('eventId') || '';
  const page = Number(params.get('page') || '1');
  const status = params.get('status') || '';
  const field = params.get('field') || 'attendee_name';
  const search = (params.get('search') || '').trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId,
    ) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    (status &&
      !attendeeStatuses.includes(
        status as (typeof attendeeStatuses)[number],
      )) ||
    !attendeeSearchFields.includes(
      field as (typeof attendeeSearchFields)[number],
    ) ||
    search.length > 200
  )
    return null;
  return { eventId, page, status, field, search };
}

export function literalSearchPattern(search: string) {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

export async function authorisedAttendeeList<T>(
  userId: string | null,
  eventId: string,
  source: {
    canView: (userId: string, eventId: string) => Promise<boolean>;
    list: () => Promise<T>;
  },
) {
  if (!userId)
    return { status: 401, error: 'Authentication required.' } as const;
  if (!(await source.canView(userId, eventId))) {
    return {
      status: 404,
      error: 'Event not found or access unavailable.',
    } as const;
  }
  return { status: 200, data: await source.list() } as const;
}
