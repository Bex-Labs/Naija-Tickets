import type { GroupBooking } from './group-bookings.ts';
export const ORDER_REFERENCE_PATTERN = /^[a-f0-9]{36}$/i;

export type StoredTicketOrder = {
  id: string;
  reference: string;
  status: string;
  paymentStatus?: string;
  currency: string;
  event_id: string;
};

export type StoredTicketEvent = {
  title: string;
  presenterLine: string;
  category: string;
  startsAt: string;
  timezone: string;
  timezoneLabel: string;
  venue: string;
  city: string;
  address: string;
};

export type StoredTicketOrderItem = {
  admissionsPerTicket?: number;
  id: string;
  ticketType: string;
  unitPriceKobo: number;
};

export type StoredIssuedTicket = {
  id: string;
  orderItemId: string;
  attendeeName: string;
  displayCode: string;
  status: string;
  issuedAt: string;
};

export type IssuedTicketView = StoredIssuedTicket & {
  admissionsPerTicket?: number;
  ticketType: string;
  unitPriceKobo: number;
};

export type PaidTicketOrderView = {
  reference: string;
  currency: string;
  event: StoredTicketEvent;
  tickets: IssuedTicketView[];
  groups?: GroupBooking[];
};

export type TicketOrderLookup =
  | { state: 'invalid' | 'not_found' }
  | { state: 'pending' | 'failed' | 'expired' | 'refunded' }
  | { state: 'paid_without_tickets'; reference: string }
  | { state: 'success'; order: PaidTicketOrderView };

export type TicketOrderSource = {
  findGroupBookings?(orderId: string): Promise<GroupBooking[]>;
  findOrder(reference: string): Promise<StoredTicketOrder | null>;
  findEvent(eventId: string): Promise<StoredTicketEvent | null>;
  findOrderItems(orderId: string): Promise<StoredTicketOrderItem[]>;
  findIssuedTickets(orderItemIds: string[]): Promise<StoredIssuedTicket[]>;
};

export function isValidOrderReference(value: string) {
  return ORDER_REFERENCE_PATTERN.test(value);
}

function unavailableState(
  status: string,
): 'pending' | 'failed' | 'expired' | 'refunded' {
  if (status === 'pending') return 'pending';
  if (status === 'expired') return 'expired';
  if (status === 'refunded') return 'refunded';
  return 'failed';
}

export async function retrieveTicketOrder(
  reference: string,
  source: TicketOrderSource,
): Promise<TicketOrderLookup> {
  const normalizedReference = reference.trim().toLowerCase();
  if (!isValidOrderReference(normalizedReference)) return { state: 'invalid' };

  const order = await source.findOrder(normalizedReference);
  if (!order) return { state: 'not_found' };
  if (order.reference.toLowerCase() !== normalizedReference) {
    return { state: 'not_found' };
  }
  if (
    !['paid', 'partially_refunded'].includes(order.status) ||
    order.paymentStatus !== 'verified'
  ) {
    if (['failed', 'abandoned'].includes(order.paymentStatus || '')) {
      return { state: 'failed' };
    }
    return { state: unavailableState(order.status) };
  }

  const [event, orderItems] = await Promise.all([
    source.findEvent(order.event_id),
    source.findOrderItems(order.id),
  ]);
  if (!event || orderItems.length === 0) {
    return { state: 'paid_without_tickets', reference: order.reference };
  }

  const orderItemById = new Map(orderItems.map((item) => [item.id, item]));
  const issued = await source.findIssuedTickets([...orderItemById.keys()]);
  const tickets = issued.flatMap((ticket) => {
    const item = orderItemById.get(ticket.orderItemId);
    return item
      ? [
          {
            ...ticket,
            ticketType: item.ticketType,
            unitPriceKobo: item.unitPriceKobo,
            admissionsPerTicket: item.admissionsPerTicket || 1,
          },
        ]
      : [];
  });
  const groups = source.findGroupBookings
    ? await source.findGroupBookings(order.id)
    : [];
  if (tickets.length === 0 && groups.length === 0) {
    return { state: 'paid_without_tickets', reference: order.reference };
  }

  return {
    state: 'success',
    order: {
      reference: order.reference,
      currency: order.currency,
      event,
      tickets,
      groups,
    },
  };
}
