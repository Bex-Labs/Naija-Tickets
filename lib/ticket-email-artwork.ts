import QRCode from 'qrcode';
import {
  ticketArtworkLayout,
  ticketTextLines,
  type TicketArtworkDetails,
} from './ticket-artwork.ts';
import type { TicketEmailImage } from './ticket-email.ts';

export type TicketEmailArtworkRequest = TicketArtworkDetails;

type SharpFactory = (
  input: Buffer,
  options: { density: number },
) => {
  png(options: { compressionLevel: number; palette: boolean }): {
    toBuffer(): Promise<Buffer>;
  };
};

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] || character,
  );
}

function linesSvg({
  lines,
  x,
  y,
  size = 16,
  weight = 700,
  fill = '#241b3f',
  leading = 22,
}: {
  lines: string[];
  x: number;
  y: number;
  size?: number;
  weight?: number;
  fill?: string;
  leading?: number;
}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index ? leading : 0}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`;
}

function qrSvg(value: string, x: number, y: number, size: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const margin = 4;
  const cells = qr.modules.size + margin * 2;
  const runs: string[] = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    let start: number | null = null;
    for (let column = 0; column <= qr.modules.size; column += 1) {
      const dark =
        column < qr.modules.size && Boolean(qr.modules.get(row, column));
      if (dark && start === null) start = column;
      if (!dark && start !== null) {
        runs.push(
          `M${start + margin} ${row + margin}h${column - start}v1H${start + margin}z`,
        );
        start = null;
      }
    }
  }
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${cells} ${cells}" role="img"><path fill="#fffaf0" d="M0 0h${cells}v${cells}H0z" shape-rendering="crispEdges"/><path fill="#17112f" d="${runs.join('')}" shape-rendering="crispEdges"/></svg>`;
}

function ticketSvg(id: string, details: TicketArtworkDetails) {
  const {
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
    qrY,
  } = ticketArtworkLayout(details);
  const infoFields = [
    { label: 'DATE', lines: date, x: 26 },
    { label: 'START TIME', lines: time, x: 260 },
    { label: 'VENUE', lines: venue, x: 445 },
  ]
    .map(
      (field) =>
        `<g><text x="${field.x}" y="${infoY}" fill="#655d78" font-size="10" font-weight="700" letter-spacing="1.5">${field.label}</text>${linesSvg({ lines: field.lines, x: field.x, y: infoY + 25 })}</g>`,
    )
    .join('');
  const admissionFields = [
    { label: details.position, lines: tier, x: 26 },
    { label: 'Attendee', lines: attendee, x: 275 },
    { label: details.priceLabel, lines: price, x: 555 },
  ]
    .map(
      (field) =>
        `<g><text x="${field.x}" y="${admissionY}" fill="#655d78" font-size="9" font-weight="700" letter-spacing="1">${escapeXml(field.label.toUpperCase())}</text>${linesSvg({ lines: field.lines, x: field.x, y: admissionY + 26 })}</g>`,
    )
    .join('');
  const orderReference = details.orderReference
    ? `<g><text x="740" y="${qrY + 246}" font-size="8" font-weight="700" fill="#ffffff" letter-spacing="1">ORDER REFERENCE</text>${linesSvg({ lines: ticketTextLines(details.orderReference, 32), x: 740, y: qrY + 262, size: 9, fill: '#ffffff', leading: 12 })}</g>`
    : '';

  return `<svg id="${escapeXml(id)}" xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-labelledby="${escapeXml(id)}-title ${escapeXml(id)}-description" font-family="Arial, Helvetica, sans-serif" class="ticket-artwork">
    <title id="${escapeXml(id)}-title">${escapeXml(`${details.eventTitle} — ${details.attendeeName}`)}</title>
    <desc id="${escapeXml(id)}-description">${escapeXml(`${details.ticketType}. ${details.date}, ${details.time}. ${details.venue}. ${details.address}. Admits one person. Ticket code ${details.displayCode}.`)}</desc>
    <rect width="960" height="${height}" fill="#fffaf0"/>
    <svg width="720" height="${height}" overflow="hidden" aria-hidden="true">
      ${[125, 143, 161].map((radius) => `<circle cx="12" cy="${height + 35}" r="${radius}" fill="none" stroke="#079669" stroke-opacity="0.25" stroke-width="2"/>`).join('')}
      <circle cx="625" cy="0" r="100" fill="none" stroke="#079669" stroke-opacity="0.13" stroke-width="2"/>
    </svg>
    <rect x="720" width="240" height="${height}" fill="#079669"/>
    <path d="M720 0V${height}" stroke="#fffaf0" stroke-width="2" stroke-dasharray="5 5"/>
    <circle cx="720" cy="0" r="10" fill="#fffaf0"/><circle cx="720" cy="${height}" r="10" fill="#fffaf0"/>
    <rect x="26" y="22" width="32" height="32" fill="#10b981"/>
    <path d="M34 32h16v3a3 3 0 0 0 0 6v3H34v-3a3 3 0 0 0 0-6z M42 32v12" fill="none" stroke="#064e3b" stroke-width="1.5"/>
    <text x="68" y="44" font-size="21" font-weight="800" letter-spacing="-1" fill="#241b3f">Naija Tickets</text>
    ${linesSvg({ lines: category, x: 465, y: 32, size: 12, fill: '#dc4b36', leading: 17 })}
    ${linesSvg({ lines: presenter, x: 350, y: 55 + (category.length - 1) * 17, size: 11, weight: 400, fill: '#655d78', leading: 17 })}
    ${linesSvg({ lines: title, x: 26, y: titleY, size: 36, weight: 900, leading: 38 })}
    <path d="M26 ${infoY - 18}H694 M26 ${infoBottom}H694" stroke="#241b3f" stroke-opacity="0.18"/>
    ${infoFields}
    ${linesSvg({ lines: address, x: 26, y: infoBottom + 23, size: 12, weight: 400, fill: '#655d78', leading: 17 })}
    ${admissionFields}
    <text x="840" y="${qrY - 17}" text-anchor="middle" fill="white" font-size="14" font-weight="800" letter-spacing="2">ADMIT ONE</text>
    <rect x="740" y="${qrY}" width="200" height="224" rx="2" fill="#fffaf0"/>
    ${qrSvg(details.displayCode, 746, qrY + 3, 188)}
    <text x="840" y="${qrY + 209}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="700" fill="#241b3f">${escapeXml(details.displayCode)}</text>
    ${orderReference}
  </svg>`;
}

function safeFilename(value: string) {
  const safe = value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '');
  return safe || 'naija-ticket';
}

// Render the same ticket layout used on the post-payment page as a PNG for
// broad email-client support. Each QR encodes the same admission code.
export async function renderTicketEmailArtwork(
  tickets: TicketEmailArtworkRequest[],
): Promise<TicketEmailImage[]> {
  if (tickets.length === 0) return [];

  // Payment routes also import ticket delivery. Load the native renderer only
  // when a verified purchase actually has ticket images to send.
  const [{ default: sharp }, { outlineTicketEmailText }] = await Promise.all([
    import('sharp'),
    import('./ticket-email-fonts.ts'),
  ]);
  const rasterise = sharp as unknown as SharpFactory;

  return Promise.all(
    tickets.map(async (details, index) => {
      const safeCode = safeFilename(details.displayCode).slice(0, 72);
      const contentId = `naija-ticket-${index + 1}-${safeCode}`.slice(0, 120);
      const image = await rasterise(
        Buffer.from(
          await outlineTicketEmailText(
            ticketSvg(`email-ticket-${index + 1}`, details),
          ),
        ),
        { density: 144 },
      )
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();

      return {
        displayCode: details.displayCode,
        contentId,
        filename: `${safeCode}.png`,
        content: image.toString('base64'),
        contentType: 'image/png' as const,
      };
    }),
  );
}
