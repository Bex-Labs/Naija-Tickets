import type {
  OrganiserPolicy,
  OrganiserScheduleItem,
  OrganiserTicketType,
} from './organiser-types.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

type ParsedTicket = Omit<OrganiserTicketType, 'priceNaira'> & {
  priceKobo: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
};

export type OrganiserEventInput = {
  id: string | null;
  title: string;
  presenterLine: string;
  category: string;
  city: string;
  venue: string;
  address: string;
  directionsUrl: string | null;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  timezoneLabel: string;
  startsAt: string;
  endsAt: string;
  salesStartAt: string | null;
  salesEndAt: string | null;
  description: string;
  imageUrl: string | null;
  organiserDisplayName: string;
  organiserAbout: string;
  schedule: OrganiserScheduleItem[];
  policies: OrganiserPolicy[];
  ticketTypes: ParsedTicket[];
  status: 'draft' | 'submitted';
};

type ParseResult =
  | { value: OrganiserEventInput; error?: never }
  | { value?: never; error: string };

function text(body: Record<string, unknown>, key: string) {
  return typeof body[key] === 'string' ? body[key].trim() : '';
}

function httpUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function localIso(date: string, time: string) {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
  const value = new Date(`${date}T${time}:00+01:00`);
  if (Number.isNaN(value.getTime())) return null;
  const [year, month, day] = date.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return value.toISOString();
}

function optionalLocalIso(value: string) {
  if (!value) return null;
  if (!DATETIME_PATTERN.test(value)) return undefined;
  const [date, time] = value.split('T');
  return localIso(date, time) || undefined;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : null;
}

export function parseOrganiserEventInput(
  body: Record<string, unknown>,
): ParseResult {
  const id = text(body, 'id');
  const title = text(body, 'title');
  const presenterLine = text(body, 'presenterLine');
  const category = text(body, 'category');
  const city = text(body, 'city');
  const venue = text(body, 'venue');
  const address = text(body, 'address');
  const directionsInput = text(body, 'directionsUrl');
  const date = text(body, 'date');
  const time = text(body, 'time');
  const endDate = text(body, 'endDate');
  const endTime = text(body, 'endTime');
  const timezoneLabel = text(body, 'timezoneLabel').toUpperCase();
  const salesStart = text(body, 'salesStart');
  const salesEnd = text(body, 'salesEnd');
  const description = text(body, 'description');
  const imageInput = text(body, 'imageName');
  const organiserDisplayName = text(body, 'organiserDisplayName');
  const organiserAbout = text(body, 'organiserAbout');
  const status = text(body, 'status');

  if (id && !UUID_PATTERN.test(id)) {
    return { error: 'The event identifier is invalid.' };
  }
  if (title.length < 3 || title.length > 160) {
    return { error: 'Use an event title between 3 and 160 characters.' };
  }
  if (presenterLine.length < 2 || presenterLine.length > 160) {
    return { error: 'Add a presenter byline under 160 characters.' };
  }
  if (!category || !city) {
    return { error: 'Choose the event category and city.' };
  }
  if (venue.length < 2 || venue.length > 160) {
    return { error: 'Add a valid venue name.' };
  }
  if (address.length < 5 || address.length > 300) {
    return { error: 'Add the full street address.' };
  }
  const directionsUrl = httpUrl(directionsInput);
  if (directionsInput && !directionsUrl) {
    return { error: 'Use a valid HTTP or HTTPS directions link.' };
  }
  if (!/^[A-Z0-9 +:/-]{2,16}$/.test(timezoneLabel)) {
    return { error: 'Use a short timezone label such as WAT.' };
  }
  const startsAt = localIso(date, time);
  const endsAt = localIso(endDate, endTime);
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
    return { error: 'Use valid start and end dates and times.' };
  }
  const salesStartAt = optionalLocalIso(salesStart);
  const salesEndAt = optionalLocalIso(salesEnd);
  if (salesStartAt === undefined || salesEndAt === undefined) {
    return { error: 'Use valid event sales dates and times.' };
  }
  if (
    salesStartAt &&
    salesEndAt &&
    new Date(salesEndAt) <= new Date(salesStartAt)
  ) {
    return { error: 'Event ticket sales must end after they start.' };
  }
  if (description.length < 20 || description.length > 6000) {
    return { error: 'Describe the event in 20 to 6000 characters.' };
  }
  const imageUrl = httpUrl(imageInput);
  if (imageInput && !imageUrl) {
    return { error: 'Use a valid HTTP or HTTPS event image link.' };
  }
  if (organiserDisplayName.length < 2 || organiserDisplayName.length > 120) {
    return { error: 'Add a valid organiser display name.' };
  }
  if (organiserAbout.length > 1200) {
    return { error: 'Keep the organiser profile under 1200 characters.' };
  }
  if (!['draft', 'submitted'].includes(status)) {
    return { error: 'The event status is invalid.' };
  }

  const scheduleInput = array(body.schedule);
  if (!scheduleInput || scheduleInput.length > 30) {
    return { error: 'Add no more than 30 schedule rows.' };
  }
  const schedule: OrganiserScheduleItem[] = [];
  for (const value of scheduleInput) {
    if (!value || typeof value !== 'object') {
      return { error: 'Check every schedule row.' };
    }
    const item = value as Record<string, unknown>;
    const itemTime = typeof item.time === 'string' ? item.time.trim() : '';
    const itemTitle = typeof item.title === 'string' ? item.title.trim() : '';
    if (
      !TIME_PATTERN.test(itemTime) ||
      itemTitle.length < 2 ||
      itemTitle.length > 160
    ) {
      return { error: 'Each schedule row needs a valid time and label.' };
    }
    schedule.push({ time: itemTime, title: itemTitle });
  }

  const policiesInput = array(body.policies);
  if (!policiesInput || policiesInput.length > 30) {
    return { error: 'Add no more than 30 event policies.' };
  }
  const policies: OrganiserPolicy[] = [];
  for (const value of policiesInput) {
    if (!value || typeof value !== 'object') {
      return { error: 'Check every event policy.' };
    }
    const policy = value as Record<string, unknown>;
    const policyText =
      typeof policy.text === 'string' ? policy.text.trim() : '';
    if (policyText.length < 3 || policyText.length > 500) {
      return { error: 'Each event policy must contain 3 to 500 characters.' };
    }
    policies.push({ text: policyText });
  }

  const ticketInput = array(body.ticketTypes);
  if (!ticketInput || ticketInput.length === 0 || ticketInput.length > 20) {
    return { error: 'Add between 1 and 20 ticket tiers.' };
  }
  const ticketTypes: ParsedTicket[] = [];
  const ticketNames = new Set<string>();
  const ticketIds = new Set<string>();
  for (const value of ticketInput) {
    if (!value || typeof value !== 'object') {
      return { error: 'Check every ticket tier.' };
    }
    const ticket = value as Record<string, unknown>;
    const ticketId = typeof ticket.id === 'string' ? ticket.id.trim() : '';
    const name = typeof ticket.name === 'string' ? ticket.name.trim() : '';
    const ticketDescription =
      typeof ticket.description === 'string' ? ticket.description.trim() : '';
    const priceNaira = Number(ticket.priceNaira);
    const quantityTotal = Number(ticket.quantityTotal);
    const quantitySold = Number(ticket.quantitySold || 0);
    const quantityReserved = Number(ticket.quantityReserved || 0);
    const minPerOrder = Number(ticket.minPerOrder);
    const maxPerOrder = Number(ticket.maxPerOrder);
    const ticketSalesStart =
      typeof ticket.salesStart === 'string' ? ticket.salesStart.trim() : '';
    const ticketSalesEnd =
      typeof ticket.salesEnd === 'string' ? ticket.salesEnd.trim() : '';
    const ticketSalesStartAt = optionalLocalIso(ticketSalesStart);
    const ticketSalesEndAt = optionalLocalIso(ticketSalesEnd);
    const inclusionInput = array(ticket.inclusions);
    const active = ticket.active !== false;

    if (ticketId && !UUID_PATTERN.test(ticketId)) {
      return { error: 'A ticket tier identifier is invalid.' };
    }
    if (ticketId && ticketIds.has(ticketId)) {
      return { error: 'A ticket tier was included more than once.' };
    }
    if (ticketId) ticketIds.add(ticketId);
    if (name.length < 2 || name.length > 100) {
      return { error: 'Each ticket tier needs a name under 100 characters.' };
    }
    const comparableName = name.toLowerCase();
    if (ticketNames.has(comparableName)) {
      return { error: 'Ticket tier names must be unique.' };
    }
    ticketNames.add(comparableName);
    if (ticketDescription.length > 500) {
      return { error: 'Keep ticket descriptions under 500 characters.' };
    }
    const priceKobo = Math.round(priceNaira * 100);
    if (
      !Number.isFinite(priceNaira) ||
      priceNaira < 0 ||
      !Number.isSafeInteger(priceKobo) ||
      Math.abs(priceKobo / 100 - priceNaira) > 0.000001
    ) {
      return { error: 'Ticket prices must be valid non-negative NGN amounts.' };
    }
    if (
      !Number.isSafeInteger(quantityTotal) ||
      quantityTotal < 0 ||
      quantityTotal > 1000000 ||
      !Number.isSafeInteger(quantitySold) ||
      !Number.isSafeInteger(quantityReserved) ||
      quantityTotal < quantitySold + quantityReserved
    ) {
      return {
        error: 'Ticket capacity cannot be below sold and reserved inventory.',
      };
    }
    if (
      !Number.isSafeInteger(minPerOrder) ||
      !Number.isSafeInteger(maxPerOrder) ||
      minPerOrder < 1 ||
      maxPerOrder < minPerOrder ||
      maxPerOrder > 20
    ) {
      return { error: 'Check the ticket minimum and maximum per order.' };
    }
    if (ticketSalesStartAt === undefined || ticketSalesEndAt === undefined) {
      return { error: 'Use valid ticket sales dates and times.' };
    }
    if (
      ticketSalesStartAt &&
      ticketSalesEndAt &&
      new Date(ticketSalesEndAt) <= new Date(ticketSalesStartAt)
    ) {
      return { error: 'Ticket sales must end after they start.' };
    }
    if (!inclusionInput || inclusionInput.length > 20) {
      return { error: 'Add no more than 20 benefits to a ticket tier.' };
    }
    const inclusions = inclusionInput.map((item) =>
      typeof item === 'string' ? item.trim() : '',
    );
    if (inclusions.some((item) => item.length < 2 || item.length > 160)) {
      return { error: 'Each ticket benefit must contain 2 to 160 characters.' };
    }

    ticketTypes.push({
      id: ticketId || undefined,
      name,
      description: ticketDescription,
      priceKobo,
      quantityTotal,
      quantitySold,
      quantityReserved,
      minPerOrder,
      maxPerOrder,
      salesStart: ticketSalesStart,
      salesEnd: ticketSalesEnd,
      salesStartAt: ticketSalesStartAt,
      salesEndAt: ticketSalesEndAt,
      inclusions,
      active,
    });
  }
  if (!ticketTypes.some((ticket) => ticket.active)) {
    return { error: 'Keep at least one ticket tier available.' };
  }

  return {
    value: {
      id: id || null,
      title,
      presenterLine,
      category,
      city,
      venue,
      address,
      directionsUrl,
      date,
      time,
      endDate,
      endTime,
      timezoneLabel,
      startsAt,
      endsAt,
      salesStartAt,
      salesEndAt,
      description,
      imageUrl,
      organiserDisplayName,
      organiserAbout,
      schedule,
      policies,
      ticketTypes,
      status: status as 'draft' | 'submitted',
    },
  };
}
