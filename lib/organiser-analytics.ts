export type EventSalesRow = {
  event_id: string;
  event_title: string;
  category_name: string;
  event_status: string;
  starts_at: string;
  tickets_sold: number | string;
  revenue_kobo: number | string;
  inventory_remaining: number | string;
  inventory_reserved: number | string;
  inventory_total: number | string;
};

export type EventSales = {
  eventId: string;
  title: string;
  category: string;
  status: string;
  startsAt: string;
  ticketsSold: number;
  revenueKobo: number;
  inventoryRemaining: number;
  inventoryReserved: number;
  inventoryTotal: number;
};

export type SalesCategory = {
  category: string;
  ticketsSold: number;
  revenueKobo: number;
};

export type OrganiserSalesAnalytics = {
  ticketsSold: number;
  revenueKobo: number;
  inventoryRemaining: number;
  inventoryReserved: number;
  categories: SalesCategory[];
  events: EventSales[];
};

export function aggregateOrganiserSales(
  rows: EventSalesRow[],
): OrganiserSalesAnalytics {
  const events: EventSales[] = rows.map((row) => ({
    eventId: row.event_id,
    title: row.event_title,
    category: row.category_name,
    status: row.event_status,
    startsAt: row.starts_at,
    ticketsSold: Number(row.tickets_sold),
    revenueKobo: Number(row.revenue_kobo),
    inventoryRemaining: Number(row.inventory_remaining),
    inventoryReserved: Number(row.inventory_reserved),
    inventoryTotal: Number(row.inventory_total),
  }));
  const byCategory = new Map<string, SalesCategory>();
  for (const event of events) {
    const category = byCategory.get(event.category) || {
      category: event.category,
      ticketsSold: 0,
      revenueKobo: 0,
    };
    category.ticketsSold += event.ticketsSold;
    category.revenueKobo += event.revenueKobo;
    byCategory.set(event.category, category);
  }
  return {
    ticketsSold: events.reduce((sum, event) => sum + event.ticketsSold, 0),
    revenueKobo: events.reduce((sum, event) => sum + event.revenueKobo, 0),
    inventoryRemaining: events.reduce(
      (sum, event) => sum + event.inventoryRemaining,
      0,
    ),
    inventoryReserved: events.reduce(
      (sum, event) => sum + event.inventoryReserved,
      0,
    ),
    categories: [...byCategory.values()].sort(
      (a, b) =>
        b.revenueKobo - a.revenueKobo || a.category.localeCompare(b.category),
    ),
    events,
  };
}
