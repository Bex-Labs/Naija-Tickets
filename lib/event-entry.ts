export type EntryEvent = {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  canManageStaff: boolean;
  staff: { id: string; name: string }[];
};
export type EntryResult = {
  outcome:
    | 'valid'
    | 'admitted'
    | 'already_used'
    | 'invalid'
    | 'cancelled'
    | 'refunded'
    | 'unpaid'
    | 'event_unavailable';
  admitted: boolean;
  attendeeName?: string;
  ticketType?: string;
  displayCode?: string;
  eventTitle?: string;
  admissionLimit?: number;
  admissionsUsed?: number;
  checkedInAt?: string;
};
export const entryMessages: Record<EntryResult['outcome'], string> = {
  valid: 'Valid ticket — ready for admission',
  admitted: 'Guest admitted',
  already_used: 'Entry rejected — ticket already used',
  invalid: 'Entry rejected — invalid ticket for this event',
  cancelled: 'Entry rejected — ticket cancelled',
  refunded: 'Entry rejected — ticket refunded',
  unpaid: 'Entry rejected — payment is not verified',
  event_unavailable: 'Entry rejected — event is not open for entry',
};
export const isEntryEventId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
