export type AdminSalesCategory = {
  category: string;
  ticketsSold: number;
  revenueKobo: number;
};

export type AdminTopEvent = {
  eventId: string;
  title: string;
  organiser: string;
  category: string;
  status: string;
  bookings: number;
  ticketsSold: number;
  revenueKobo: number;
  inventoryRemaining: number;
};

export type AdminSalesAnalytics = {
  eventCount: number;
  bookings: number;
  ticketsSold: number;
  ticketRevenueKobo: number;
  serviceFeesKobo: number;
  inventoryRemaining: number;
  inventoryReserved: number;
  categories: AdminSalesCategory[];
  topEvents: AdminTopEvent[];
};
