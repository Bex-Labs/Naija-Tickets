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
  timezoneLabel: string;
  salesStart: string;
  salesEnd: string;
  description: string;
  imageName: string;
  organiserDisplayName: string;
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
  id?: string;
  clientKey?: string;
  name: string;
  description: string;
  priceNaira: number;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStart: string;
  salesEnd: string;
  inclusions: string[];
  active: boolean;
};
