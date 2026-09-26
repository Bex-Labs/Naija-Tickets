export type TicketType = {
  id?: string;
  name: string;
  description?: string;
  price: number;
  earlyBirdPrice?: number;
  earlyBirdEndsAt?: string;
  remaining: number;
  minPerOrder?: number;
  maxPerOrder?: number;
  salesStartAt?: string;
  salesEndAt?: string;
  saleState?: 'open' | 'upcoming' | 'closed';
  status?: 'available' | 'sold-out' | 'not-on-sale';
  inclusions?: string[];
};

export type Event = {
  id?: string;
  slug: string;
  title: string;
  organiser: string;
  organiserVerified?: boolean;
  presenterLine?: string;
  organiserAbout?: string;
  organiserImage?: string;
  organiserSocials?: Array<{ label: string; url: string }>;
  city: string;
  state: string;
  venue: string;
  address: string;
  directionsUrl?: string;
  category: string;
  date: string;
  endsAt?: string;
  displayDate: string;
  time: string;
  timezoneLabel?: string;
  image: string;
  description: string;
  featured?: boolean;
  soldOut?: boolean;
  ticketsSold?: number;
  pricingTime?: number;
  ticketTypes: TicketType[];
  schedule: { time: string; title: string }[];
  policies: string[];
};

export const featuredCities = [
  'Lagos',
  'Abuja',
  'Kaduna',
  'Kano',
  'Ibadan',
  'Port Harcourt',
] as const;

export const cityOptions = [
  { city: 'Lagos', state: 'Lagos' },
  { city: 'Kano', state: 'Kano' },
  { city: 'Ibadan', state: 'Oyo' },
  { city: 'Abuja', state: 'FCT' },
  { city: 'Port Harcourt', state: 'Rivers' },
  { city: 'Benin City', state: 'Edo' },
  { city: 'Kaduna', state: 'Kaduna' },
  { city: 'Maiduguri', state: 'Borno' },
  { city: 'Zaria', state: 'Kaduna' },
  { city: 'Aba', state: 'Abia' },
  { city: 'Jos', state: 'Plateau' },
  { city: 'Ilorin', state: 'Kwara' },
  { city: 'Oyo', state: 'Oyo' },
  { city: 'Enugu', state: 'Enugu' },
  { city: 'Abeokuta', state: 'Ogun' },
  { city: 'Sokoto', state: 'Sokoto' },
  { city: 'Onitsha', state: 'Anambra' },
  { city: 'Warri', state: 'Delta' },
  { city: 'Calabar', state: 'Cross River' },
  { city: 'Uyo', state: 'Akwa Ibom' },
] as const;

export const cities: string[] = cityOptions.map(({ city }) => city);

export function stateForCity(city: string) {
  return cityOptions.find((option) => option.city === city)?.state || city;
}

export const categories = [
  'Concert',
  'Conference',
  'Festival',
  'Trade show',
  'Workshop',
  'Sports',
  'Spirituality & religion',
  'Community',
  'Food & drinks',
  'Book clubs',
  'Arts & culture',
  'Business',
  'Technology',
  'Health & wellness',
  'Fashion',
  'Comedy',
  'Film',
  'Nightlife',
];

export const homeCategories = [
  'Concert',
  'Festival',
  'Conference',
  'Community',
  'Food & drinks',
  'Spirituality & religion',
  'Sports',
  'Arts & culture',
] as const;

export const formatNaira = (kobo: number) =>
  kobo === 0
    ? 'Free'
    : new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        maximumFractionDigits: 0,
      }).format(kobo / 100);

export const isEarlyBirdTicket = (
  ticket: TicketType,
  at = Date.now(),
): boolean =>
  ticket.earlyBirdPrice !== undefined &&
  Boolean(ticket.earlyBirdEndsAt) &&
  new Date(ticket.earlyBirdEndsAt || '').getTime() > at;

export const ticketPrice = (ticket: TicketType, at = Date.now()) =>
  isEarlyBirdTicket(ticket, at)
    ? (ticket.earlyBirdPrice ?? ticket.price)
    : ticket.price;

export const eventPrice = (event: Event) =>
  Math.min(...event.ticketTypes.map((ticket) => ticketPrice(ticket)));
