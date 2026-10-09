// Keep line breaks in the artwork itself so screen, print and image export
// cannot independently reflow the ticket. Long words are split, never dropped.
export type TicketArtworkDetails = {
  eventTitle: string;
  category: string;
  presenter: string;
  date: string;
  time: string;
  venue: string;
  address: string;
  ticketType: string;
  attendeeName: string;
  price: string;
  priceLabel: string;
  displayCode: string;
  orderReference?: string;
  position: string;
};

function lineWidth(value: string) {
  return Array.from(value).reduce(
    (sum, character) =>
      sum +
      (/[WM@%]/.test(character)
        ? 1.6
        : (character.codePointAt(0) || 0) > 0x024f
          ? 1.8
          : 1),
    0,
  );
}

export function ticketTextLines(value: string, limit: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const chunks = Array.from(word).reduce<string[]>((parts, character) => {
      if (
        !parts.length ||
        lineWidth(parts[parts.length - 1] + character) > limit
      )
        parts.push(character);
      else parts[parts.length - 1] += character;
      return parts;
    }, []);
    for (const chunk of chunks) {
      if (lineWidth(line ? `${line} ${chunk}` : chunk) > limit) {
        lines.push(line);
        line = chunk;
      } else line = line ? `${line} ${chunk}` : chunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function ticketArtworkLayout(details: TicketArtworkDetails) {
  const title = ticketTextLines(details.eventTitle.toUpperCase(), 27);
  const presenter = ticketTextLines(details.presenter, 45);
  const category = ticketTextLines(details.category.toUpperCase(), 28);
  const titleY = 90 + (presenter.length - 1 + category.length - 1) * 17;
  const infoY = titleY + title.length * 38 + 16;
  const date = ticketTextLines(details.date, 20);
  const time = ticketTextLines(details.time, 14);
  const venue = ticketTextLines(details.venue, 22);
  const infoBottom =
    infoY + 22 + Math.max(date.length, time.length, venue.length) * 22;
  const address = ticketTextLines(details.address, 78);
  const admissionY = infoBottom + 30 + address.length * 17;
  const tier = ticketTextLines(details.ticketType, 24);
  const attendee = ticketTextLines(details.attendeeName, 25);
  const price = ticketTextLines(details.price, 15);
  const height = Math.max(
    360,
    admissionY + 34 + Math.max(tier.length, attendee.length, price.length) * 22,
  );
  return {
    title,
    presenter,
    category,
    titleY,
    infoY,
    date,
    time,
    venue,
    infoBottom,
    address,
    admissionY,
    tier,
    attendee,
    price,
    height,
    qrY: (height - 280) / 2 + 40,
  };
}
