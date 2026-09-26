export type OrganiserEvent = {
  id: string;
  title: string;
  presenterLine: string;
  category: string;
  city: string;
  venue: string;
  address: string;
  directionsUrl: string;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  endsAt?: string;
  timezoneLabel: string;
  salesStart: string;
  salesEnd: string;
  description: string;
  imageName: string;
  organiserDisplayName: string;
  organiserVerified?: boolean;
  organiserAbout: string;
  featured: boolean;
  schedule: OrganiserScheduleItem[];
  policies: OrganiserPolicy[];
  ticketTypes: OrganiserTicketType[];
  status:
    | 'draft'
    | 'submitted'
    | 'published'
    | 'rejected'
    | 'cancelled'
    | 'completed';
  reason?: string;
};

export type OrganiserScheduleItem = {
  id?: string;
  clientKey?: string;
  time: string;
  title: string;
};

export type OrganiserPolicy = {
  id?: string;
  clientKey?: string;
  text: string;
};

export type OrganiserTicketType = {
  admissionsPerTicket?: number;
  id?: string;
  clientKey?: string;
  name: string;
  description: string;
  priceNaira: number;
  earlyBirdPriceNaira: number | null;
  earlyBirdEnd: string;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  minPerOrder: number;
  maxPerOrder: number;
  inclusions: string[];
  active: boolean;
};
