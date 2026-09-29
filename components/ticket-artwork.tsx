/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline vector artwork needs an image role and an accessible title. */
import { QRCodeSVG } from 'qrcode.react';
import { ticketTextLines } from '@/lib/ticket-artwork';

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

function Lines({
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
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index ? leading : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// Self-contained SVG: no external images, CSS, fonts or HTML foreignObjects.
// This exact node is printed as a vector and rasterised when saved/shared.
export function TicketArtwork({
  id,
  details,
}: {
  id: string;
  details: TicketArtworkDetails;
}) {
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
  const qrY = (height - 280) / 2 + 40;
  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      width="960"
      height={height}
      viewBox={`0 0 960 ${height}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
      fontFamily="Arial, Helvetica, sans-serif"
      className="ticket-artwork"
    >
      <title id={`${id}-title`}>
        {`${details.eventTitle} — ${details.attendeeName}`}
      </title>
      <desc id={`${id}-description`}>
        {details.ticketType}. {details.date}, {details.time}. {details.venue}.{' '}
        {details.address}. Admits one person. Ticket code {details.displayCode}.
      </desc>
      <rect width="960" height={height} fill="#fffaf0" />
      <svg width="720" height={height} overflow="hidden" aria-hidden="true">
        {[125, 143, 161].map((radius) => (
          <circle
            key={radius}
            cx="12"
            cy={height + 35}
            r={radius}
            fill="none"
            stroke="#079669"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
        ))}
        <circle
          cx="625"
          cy="0"
          r="100"
          fill="none"
          stroke="#079669"
          strokeOpacity="0.13"
          strokeWidth="2"
        />
      </svg>
      <rect x="720" width="240" height={height} fill="#079669" />
      <path
        d={`M720 0V${height}`}
        stroke="#fffaf0"
        strokeWidth="2"
        strokeDasharray="5 5"
      />
      <circle cx="720" cy="0" r="10" fill="#fffaf0" />
      <circle cx="720" cy={height} r="10" fill="#fffaf0" />
      <rect x="26" y="22" width="32" height="32" fill="#10b981" />
      <path
        d="M34 32h16v3a3 3 0 0 0 0 6v3H34v-3a3 3 0 0 0 0-6z M42 32v12"
        fill="none"
        stroke="#064e3b"
        strokeWidth="1.5"
      />
      <text
        x="68"
        y="44"
        fontSize="21"
        fontWeight="800"
        letterSpacing="-1"
        fill="#241b3f"
      >
        Naija Tickets
      </text>
      <Lines
        lines={category}
        x={465}
        y={32}
        size={12}
        fill="#dc4b36"
        leading={17}
      />
      <Lines
        lines={presenter}
        x={350}
        y={55 + (category.length - 1) * 17}
        size={11}
        weight={400}
        fill="#655d78"
        leading={17}
      />
      <Lines
        lines={title}
        x={26}
        y={titleY}
        size={36}
        weight={900}
        leading={38}
      />
      <path
        d={`M26 ${infoY - 18}H694 M26 ${infoBottom}H694`}
        stroke="#241b3f"
        strokeOpacity="0.18"
      />
      {[
        { label: 'DATE', lines: date, x: 26 },
        { label: 'START TIME', lines: time, x: 260 },
        { label: 'VENUE', lines: venue, x: 445 },
      ].map((field) => (
        <g key={field.label}>
          <text
            x={field.x}
            y={infoY}
            fill="#655d78"
            fontSize="10"
            fontWeight="700"
            letterSpacing="1.5"
          >
            {field.label}
          </text>
          <Lines lines={field.lines} x={field.x} y={infoY + 25} />
        </g>
      ))}
      <Lines
        lines={address}
        x={26}
        y={infoBottom + 23}
        size={12}
        weight={400}
        fill="#655d78"
        leading={17}
      />
      {[
        { label: details.position, lines: tier, x: 26 },
        { label: 'Attendee', lines: attendee, x: 275 },
        { label: details.priceLabel, lines: price, x: 555 },
      ].map((field) => (
        <g key={field.label}>
          <text
            x={field.x}
            y={admissionY}
            fill="#655d78"
            fontSize="9"
            fontWeight="700"
            letterSpacing="1"
          >
            {field.label.toUpperCase()}
          </text>
          <Lines lines={field.lines} x={field.x} y={admissionY + 26} />
        </g>
      ))}
      <text
        x="840"
        y={qrY - 17}
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="800"
        letterSpacing="2"
      >
        ADMIT ONE
      </text>
      <rect x="740" y={qrY} width="200" height="224" rx="2" fill="#fffaf0" />
      <QRCodeSVG
        x={746}
        y={qrY + 3}
        value={details.displayCode}
        size={188}
        level="M"
        marginSize={4}
        bgColor="#fffaf0"
        fgColor="#17112f"
      />
      <text
        x="840"
        y={qrY + 209}
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="13"
        fontWeight="700"
        fill="#241b3f"
      >
        {details.displayCode}
      </text>
      {details.orderReference && (
        <g>
          <text
            x="740"
            y={qrY + 246}
            fontSize="8"
            fontWeight="700"
            fill="#ffffff"
            letterSpacing="1"
          >
            ORDER REFERENCE
          </text>
          <Lines
            lines={ticketTextLines(details.orderReference, 32)}
            x={740}
            y={qrY + 262}
            size={9}
            fill="#ffffff"
            leading={12}
          />
        </g>
      )}
    </svg>
  );
}
