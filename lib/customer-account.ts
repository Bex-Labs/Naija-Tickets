import { eventHasEnded } from './event-availability.ts';

export type CustomerTicket = {
  id: string;
  attendeeName: string;
  displayCode: string;
  status: string;
  issuedAt: string;
  ticketType: string;
};

export type CustomerPurchase = {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotalKobo: number;
  discountKobo: number;
  feeKobo: number;
  totalKobo: number;
  createdAt: string;
  paidAt: string | null;
  event: {
    title: string;
    slug: string;
    startsAt: string;
    timezone: string;
    timezoneLabel: string;
    venue: string;
    city: string;
    image: string;
  } | null;
  quantity: number;
  tickets: CustomerTicket[];
};

export type CustomerProfile = { name: string; email: string; phone: string };

export type CustomerAccount = {
  profile: CustomerProfile;
  notifications: CustomerNotification[];
  purchases: CustomerPurchase[];
  savedEvents: CustomerSavedEvent[];
};

export type CustomerNotification = {
  id: string;
  type:
    | 'purchase_confirmed'
    | 'event_available'
    | 'event_unavailable'
    | 'event_updated';
  title: string;
  message: string;
  link: string | null;
  createdAt: string;
};

export type CustomerSavedEvent = {
  eventId: string;
  savedAt: string;
  available: boolean;
  title: string;
  slug: string | null;
  startsAt: string | null;
  timezone: string;
  timezoneLabel: string;
  venue: string;
  city: string;
  image: string;
};

type OrderRow = {
  id: string;
  reference: string;
  status: string;
  currency: string;
  subtotal_kobo: string | number;
  discount_kobo?: string | number | null;
  fee_kobo: string | number;
  total_kobo: string | number;
  created_at: string;
  paid_at: string | null;
  event_id: string;
};

type EventRow = {
  id: string;
  title: string;
  slug: string;
  starts_at: string;
  ends_at?: string;
  timezone: string;
  timezone_label: string | null;
  venue_name: string;
  city: string;
  image_path: string | null;
  status?: string;
};

type SavedEventRow = {
  event_id: string;
  created_at: string;
};

type ItemRow = {
  id: string;
  order_id: string;
  quantity: number;
  ticketType: string;
};

type TicketRow = {
  id: string;
  order_item_id: string;
  attendee_name: string;
  display_code: string;
  status: string;
  issued_at: string;
};

type PaymentRow = {
  order_id: string;
  status: string;
  created_at: string;
};

export function buildCustomerPurchases(
  orders: OrderRow[],
  events: EventRow[],
  items: ItemRow[],
  tickets: TicketRow[],
  payments: PaymentRow[],
): CustomerPurchase[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of items) {
    itemsByOrder.set(item.order_id, [
      ...(itemsByOrder.get(item.order_id) || []),
      item,
    ]);
  }
  const ticketsByOrder = new Map<string, CustomerTicket[]>();
  const latestPaymentByOrder = new Map<string, PaymentRow>();
  for (const payment of payments) {
    const current = latestPaymentByOrder.get(payment.order_id);
    if (!current || payment.created_at > current.created_at) {
      latestPaymentByOrder.set(payment.order_id, payment);
    }
  }
  for (const ticket of tickets) {
    const item = itemById.get(ticket.order_item_id);
    if (!item) continue;
    ticketsByOrder.set(item.order_id, [
      ...(ticketsByOrder.get(item.order_id) || []),
      {
        id: ticket.id,
        attendeeName: ticket.attendee_name,
        displayCode: ticket.display_code,
        status: ticket.status,
        issuedAt: ticket.issued_at,
        ticketType: item.ticketType,
      },
    ]);
  }

  return orders.map((order) => {
    const event = eventById.get(order.event_id);
    const orderItems = itemsByOrder.get(order.id) || [];
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      paymentStatus:
        latestPaymentByOrder.get(order.id)?.status ||
        (order.status === 'paid' ? 'verified' : 'not_started'),
      currency: order.currency,
      subtotalKobo: Number(order.subtotal_kobo),
      discountKobo: Number(order.discount_kobo || 0),
      feeKobo: Number(order.fee_kobo),
      totalKobo: Number(order.total_kobo),
      createdAt: order.created_at,
      paidAt: order.paid_at,
      event: event
        ? {
            title: event.title,
            slug: event.slug,
            startsAt: event.starts_at,
            timezone: event.timezone || 'Africa/Lagos',
            timezoneLabel: event.timezone_label || 'WAT',
            venue: event.venue_name,
            city: event.city,
            image: event.image_path || '',
          }
        : null,
      quantity: orderItems.reduce((total, item) => total + item.quantity, 0),
      tickets: ticketsByOrder.get(order.id) || [],
    };
  });
}

export function buildCustomerSavedEvents(
  savedEvents: SavedEventRow[],
  events: EventRow[],
  now = Date.now(),
): CustomerSavedEvent[] {
  const eventById = new Map(events.map((event) => [event.id, event]));
  return savedEvents.map((saved) => {
    const event = eventById.get(saved.event_id);
    const available =
      event?.status === 'published' &&
      Boolean(event.ends_at && !eventHasEnded(event.ends_at, now));
    return {
      eventId: saved.event_id,
      savedAt: saved.created_at,
      available,
      title: event?.title || 'Event unavailable',
      slug: available && event ? event.slug : null,
      startsAt: event?.starts_at || null,
      timezone: event?.timezone || 'Africa/Lagos',
      timezoneLabel: event?.timezone_label || 'WAT',
      venue: event?.venue_name || '',
      city: event?.city || '',
      image: event?.image_path || '',
    };
  });
}
