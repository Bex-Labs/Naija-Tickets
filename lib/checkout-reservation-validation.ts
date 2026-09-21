export const MAX_CHECKOUT_TICKETS_PER_TYPE = 20;
export const MAX_CHECKOUT_TICKET_TYPES = 20;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validAttendees(value: unknown, quantity: number) {
  if (!Array.isArray(value) || value.length !== quantity) return false;
  return value.every((attendee) => {
    if (!attendee || typeof attendee !== 'object') return false;
    const fields = attendee as Record<string, unknown>;
    return (
      typeof fields.name === 'string' &&
      fields.name.trim().length >= 2 &&
      fields.name.trim().length <= 120 &&
      typeof fields.email === 'string' &&
      fields.email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim()) &&
      typeof fields.phone === 'string' &&
      fields.phone.trim().length >= 7 &&
      fields.phone.trim().length <= 40
    );
  });
}

export function validReservationItem(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.ticketTypeId === 'string' &&
    UUID_PATTERN.test(item.ticketTypeId) &&
    Number.isSafeInteger(item.quantity) &&
    Number(item.quantity) > 0 &&
    Number(item.quantity) <= MAX_CHECKOUT_TICKETS_PER_TYPE &&
    validAttendees(item.attendees, Number(item.quantity))
  );
}
