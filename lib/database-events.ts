import type { Event, TicketType } from '@/lib/events';
import type { OrganiserEvent } from '@/lib/organiser-types';

export type DatabaseEventRow = {
  id: string;
  title: string;
  slug: string;
  description: string;
  presenter_line: string;
  venue_name: string;
  address: string;
  directions_url?: string | null;
  city: string;
  state: string;
  timezone: string;
  timezone_label: string;
  starts_at: string;
  ends_at: string;
  sales_start_at?: string | null;
  sales_end_at?: string | null;
  status: OrganiserEvent['status'];
  featured?: boolean;
  image_path?: string | null;
  rejection_reason?: string | null;
  organisers?:
    | {
        name: string;
        verified_at?: string | null;
        description?: string | null;
        slug?: string | null;
        contact_email?: string | null;
        logo_path?: string | null;
        website_url?: string | null;
        instagram_url?: string | null;
        x_url?: string | null;
        facebook_url?: string | null;
        tiktok_url?: string | null;
      }
    | {
        name: string;
        verified_at?: string | null;
        description?: string | null;
        slug?: string | null;
        contact_email?: string | null;
        logo_path?: string | null;
        website_url?: string | null;
        instagram_url?: string | null;
        x_url?: string | null;
        facebook_url?: string | null;
        tiktok_url?: string | null;
      }[]
    | null;
  categories?: { name: string } | { name: string }[] | null;
  event_schedule_items?: Array<{
    id: string;
    start_time: string;
    item_label: string;
    sort_order: number;
  }> | null;
  event_policies?: Array<{
    id: string;
    policy_text: string;
    sort_order: number;
  }> | null;
  ticket_types?: Array<{
    id: string;
    name: string;
    description?: string | null;
    price_kobo: number | string;
    standard_price_kobo?: number | string | null;
    early_bird_price_kobo?: number | string | null;
    early_bird_ends_at?: string | null;
    quantity_total: number;
    quantity_sold: number;
    quantity_reserved: number;
    min_per_order: number;
    max_per_order: number;
    sales_start_at?: string | null;
    sales_end_at?: string | null;
    inclusions?: string[] | null;
    active?: boolean;
    sort_order?: number;
  }> | null;
};

export const publicEventSelect =
  'id,title,slug,presenter_line,description,venue_name,address,directions_url,city,state,timezone,timezone_label,starts_at,ends_at,sales_start_at,sales_end_at,status,featured,image_path,rejection_reason,organisers(name,verified_at,description,slug,contact_email,logo_path,website_url,instagram_url,x_url,facebook_url,tiktok_url),categories(name),event_schedule_items(id,start_time,item_label,sort_order),event_policies(id,policy_text,sort_order),ticket_types(id,name,description,price_kobo,standard_price_kobo,early_bird_price_kobo,early_bird_ends_at,quantity_total,quantity_sold,quantity_reserved,min_per_order,max_per_order,sales_start_at,sales_end_at,inclusions,active,sort_order)';

export function isRetiredSeedEvent(row: DatabaseEventRow) {
  const organiser = Array.isArray(row.organisers)
    ? row.organisers[0]
    : row.organisers;
  return (
    row.slug === 'eko-sounds-live' &&
    organiser?.slug === 'palmwine-nights' &&
    organiser?.contact_email === 'demo-organiser@example.com'
  );
}

const fallbackImages: Record<string, string> = {
  Concert:
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1600&q=88',
  Conference:
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1600&q=88',
  Festival:
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1600&q=88',
  Sports:
    'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1600&q=88',
  Workshop:
    'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=88',
};

function relationName(
  relation: { name: string } | { name: string }[] | null | undefined,
  fallback: string,
) {
  if (Array.isArray(relation)) return relation[0]?.name || fallback;
  return relation?.name || fallback;
}

function organiserDetails(row: DatabaseEventRow) {
  const organiser = Array.isArray(row.organisers)
    ? row.organisers[0]
    : row.organisers;
  return {
    name: organiser?.name || 'Independent organiser',
    verified: Boolean(organiser?.verified_at),
    description: organiser?.description || '',
    image: organiser?.logo_path || '',
    socials: [
      ['Website', organiser?.website_url],
      ['Instagram', organiser?.instagram_url],
      ['X / Twitter', organiser?.x_url],
      ['Facebook', organiser?.facebook_url],
      ['TikTok', organiser?.tiktok_url],
    ]
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([label, url]) => ({ label, url })),
  };
}

function eventDateParts(value: string, timeZone = 'Africa/Lagos') {
  const date = new Date(value);
  const dateValue = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const timeValue = new Intl.DateTimeFormat('en-NG', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  return { date, dateValue, timeValue };
}

function formDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return '';
  const { dateValue, timeValue } = eventDateParts(value, timeZone);
  return `${dateValue}T${timeValue}`;
}

function displayScheduleTime(value: string) {
  const [hourValue, minute = '00'] = value.split(':');
  const hour = Number(hourValue);
  if (!Number.isInteger(hour)) return value;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

export function databaseRowToOrganiserEvent(
  row: DatabaseEventRow,
): OrganiserEvent {
  const timeZone = row.timezone || 'Africa/Lagos';
  const { dateValue, timeValue } = eventDateParts(row.starts_at, timeZone);
  const end = eventDateParts(row.ends_at, timeZone);
  const organiser = organiserDetails(row);
  return {
    id: row.id,
    title: row.title,
    presenterLine: row.presenter_line || `${organiser.name} presents`,
    category: relationName(row.categories, 'Concert'),
    city: row.city,
    venue: row.venue_name,
    address: row.address,
    directionsUrl: row.directions_url || '',
    date: dateValue,
    time: timeValue,
    endDate: end.dateValue,
    endTime: end.timeValue,
    endsAt: row.ends_at,
    timezoneLabel: row.timezone_label || 'WAT',
    salesStart: formDateTime(row.sales_start_at, timeZone),
    salesEnd: formDateTime(row.sales_end_at, timeZone),
    description: row.description,
    imageName: row.image_path || '',
    organiserDisplayName: organiser.name,
    organiserVerified: organiser.verified,
    organiserAbout: organiser.description,
    featured: row.featured === true,
    schedule: (row.event_schedule_items || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        time: item.start_time.slice(0, 5),
        title: item.item_label,
      })),
    policies: (row.event_policies || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((policy) => ({ id: policy.id, text: policy.policy_text })),
    ticketTypes: (row.ticket_types || [])
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((ticket) => ({
        id: ticket.id,
        name: ticket.name,
        description: ticket.description || '',
        priceNaira:
          Number(ticket.standard_price_kobo ?? ticket.price_kobo) / 100,
        earlyBirdPriceNaira:
          ticket.early_bird_price_kobo === null ||
          ticket.early_bird_price_kobo === undefined
            ? null
            : Number(ticket.early_bird_price_kobo) / 100,
        earlyBirdEnd: formDateTime(ticket.early_bird_ends_at, timeZone),
        quantityTotal: ticket.quantity_total,
        quantitySold: ticket.quantity_sold,
        quantityReserved: ticket.quantity_reserved,
        minPerOrder: ticket.min_per_order,
        maxPerOrder: ticket.max_per_order,
        inclusions: ticket.inclusions || [],
        active: ticket.active !== false,
      })),
    status: row.status,
    reason: row.rejection_reason || undefined,
  };
}

export function databaseRowToPublicEvent(row: DatabaseEventRow): Event {
  const category = relationName(row.categories, 'Concert');
  const organiser = organiserDetails(row);
  const timeZone = row.timezone || 'Africa/Lagos';
  const { date, dateValue } = eventDateParts(row.starts_at, timeZone);
  const now = Date.now();
  const tickets: TicketType[] = (row.ticket_types || [])
    .filter((ticket) => ticket.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((ticket) => {
      const remaining = Math.max(
        0,
        ticket.quantity_total - ticket.quantity_sold - ticket.quantity_reserved,
      );
      const salesOpen =
        (!ticket.sales_start_at ||
          new Date(ticket.sales_start_at).getTime() <= now) &&
        (!ticket.sales_end_at || new Date(ticket.sales_end_at).getTime() > now);
      const saleState = salesOpen
        ? 'open'
        : ticket.sales_start_at &&
            new Date(ticket.sales_start_at).getTime() > now
          ? 'upcoming'
          : 'closed';
      return {
        id: ticket.id,
        name: ticket.name,
        description: ticket.description || undefined,
        price: Number(ticket.standard_price_kobo ?? ticket.price_kobo),
        earlyBirdPrice:
          ticket.early_bird_price_kobo === null ||
          ticket.early_bird_price_kobo === undefined
            ? undefined
            : Number(ticket.early_bird_price_kobo),
        earlyBirdEndsAt: ticket.early_bird_ends_at || undefined,
        remaining,
        minPerOrder: ticket.min_per_order,
        maxPerOrder: ticket.max_per_order,
        salesStartAt: ticket.sales_start_at || undefined,
        salesEndAt: ticket.sales_end_at || undefined,
        saleState,
        status: !salesOpen
          ? 'not-on-sale'
          : remaining < ticket.min_per_order
            ? 'sold-out'
            : 'available',
        inclusions: ticket.inclusions || [],
      };
    });
  const ticketTypes = tickets.length
    ? tickets
    : [{ name: 'General admission', price: 0, remaining: 100 }];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    organiser: organiser.name,
    organiserVerified: organiser.verified,
    presenterLine: row.presenter_line || `${organiser.name} presents`,
    organiserAbout: organiser.description,
    organiserImage: organiser.image || undefined,
    organiserSocials: organiser.socials,
    city: row.city,
    state: row.state,
    venue: row.venue_name,
    address: row.address,
    directionsUrl: row.directions_url || undefined,
    category,
    date: dateValue,
    displayDate: new Intl.DateTimeFormat('en-NG', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
    time: `${new Intl.DateTimeFormat('en-NG', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date)} ${row.timezone_label || 'WAT'}`,
    timezoneLabel: row.timezone_label || 'WAT',
    image: row.image_path || fallbackImages[category] || fallbackImages.Concert,
    endsAt: row.ends_at,
    description: row.description,
    featured: row.featured,
    soldOut: ticketTypes.every((ticket) => ticket.status === 'sold-out'),
    ticketsSold: (row.ticket_types || []).reduce(
      (total, ticket) => total + Math.max(0, ticket.quantity_sold),
      0,
    ),
    pricingTime: now,
    ticketTypes,
    schedule: (row.event_schedule_items || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        time: displayScheduleTime(item.start_time),
        title: item.item_label,
      })),
    policies: (row.event_policies || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((policy) => policy.policy_text),
  };
}
