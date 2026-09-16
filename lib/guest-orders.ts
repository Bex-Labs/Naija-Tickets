export type GuestOrderRow = {
  id: string;
  reference: string;
  status: string;
  currency: string;
  total_kobo: number | string;
  purchaser_name: string;
  purchaser_email: string;
  purchaser_phone: string;
  created_at: string;
  personal_data_erased_at?: string | null;
  events: { title: string } | { title: string }[] | null;
  order_items: { quantity: number }[] | null;
};

export type GuestOrder = {
  id: string;
  reference: string;
  status: string;
  currency: string;
  totalKobo: number;
  purchaserName: string;
  purchaserEmail: string;
  purchaserPhone: string;
  eventTitle: string;
  ticketCount: number;
  createdAt: string;
  personalDataErasedAt: string | null;
};

function relatedEvent(row: GuestOrderRow) {
  return Array.isArray(row.events) ? row.events[0] : row.events;
}

export function mapGuestOrder(row: GuestOrderRow): GuestOrder {
  const erasedAt = row.personal_data_erased_at || null;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    currency: row.currency,
    totalKobo: Number(row.total_kobo),
    purchaserName: erasedAt ? 'Personal data removed' : row.purchaser_name,
    purchaserEmail: erasedAt ? '' : row.purchaser_email,
    purchaserPhone: erasedAt ? '' : row.purchaser_phone,
    eventTitle: relatedEvent(row)?.title || 'Event unavailable',
    ticketCount: (row.order_items || []).reduce(
      (total, item) => total + Number(item.quantity || 0),
      0,
    ),
    createdAt: row.created_at,
    personalDataErasedAt: erasedAt,
  };
}

export function filterGuestOrders(orders: GuestOrder[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return orders;
  return orders.filter((order) =>
    [
      order.purchaserName,
      order.purchaserEmail,
      order.purchaserPhone,
      order.eventTitle,
      order.reference,
      order.status,
    ].some((value) => value.toLowerCase().includes(normalized)),
  );
}
