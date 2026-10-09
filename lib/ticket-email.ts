export type TicketEmailItem = {
  attendee_name: string | null;
  attendee_email: string | null;
  display_code: string | null;
  ticket_type: string;
};

export type TicketEmailImage = {
  displayCode: string;
  contentId: string;
  filename: string;
  content: string;
  contentType: 'image/png';
};

export type TicketEmailDetails = {
  orderReference: string;
  eventTitle: string;
  eventDate: string;
  eventVenue: string;
  eventCity: string;
  eventAddress: string;
  eventTimezone: string;
  eventTimezoneLabel: string;
  tickets: TicketEmailItem[];
  totalKobo?: number;
  currency?: string;
  paidAt?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] || character,
  );
}

export function ticketEventTiming(value: string, timeZone: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('en-NG', {
      timeZone,
      dateStyle: 'full',
    }).format(date),
    time: new Intl.DateTimeFormat('en-NG', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(date)
      .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase()),
  };
}

export function ticketEmailIdempotencyKey(orderReference: string) {
  return `tickets/${orderReference}`;
}

export function ticketStatusUrl(appOrigin: string, orderReference: string) {
  const origin = new URL(appOrigin);
  if (
    origin.protocol !== 'https:' &&
    origin.hostname !== 'localhost' &&
    origin.hostname !== '127.0.0.1'
  ) {
    throw new Error('APP_URL must use HTTPS outside local development.');
  }
  return new URL(
    `/payment/status?reference=${encodeURIComponent(orderReference)}`,
    origin.origin,
  ).toString();
}

export function buildTicketEmail(
  details: TicketEmailDetails,
  appOrigin: string,
  ticketImages: TicketEmailImage[] = [],
) {
  const timing = ticketEventTiming(details.eventDate, details.eventTimezone);
  const ticketUrl = ticketStatusUrl(appOrigin, details.orderReference);
  const unclaimed = details.tickets.filter(
    (ticket) => !ticket.display_code,
  ).length;
  const groupMessage = unclaimed
    ? `${unclaimed} group admissions are reserved and waiting to be claimed. Open your booking to copy the group registration link and invite your members.`
    : '';
  const registered = details.tickets.filter((ticket) =>
    Boolean(ticket.display_code),
  );
  const imagesByCode = new Map(
    ticketImages.map((image) => [image.displayCode, image]),
  );
  const receipt =
    details.totalKobo !== undefined
      ? `Amount paid: ${new Intl.NumberFormat('en-NG', { style: 'currency', currency: details.currency || 'NGN' }).format(details.totalKobo / 100)}${details.paidAt ? ` · Paid on ${new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: details.eventTimezone }).format(new Date(details.paidAt))}` : ''}`
      : '';
  const ticketCards = registered
    .map((ticket, index) => {
      const image = imagesByCode.get(ticket.display_code || '');
      if (image) {
        return `
          <div style="margin-top:20px">
            <p style="margin:0 0 8px;color:#655d78;font-size:12px;font-weight:700">Ticket ${index + 1} of ${registered.length} · ${escapeHtml(ticket.attendee_name || '')}</p>
            <img src="cid:${escapeHtml(image.contentId)}" width="960" alt="Ticket for ${escapeHtml(ticket.attendee_name || '')} to ${escapeHtml(details.eventTitle)}" style="display:block;width:100%;height:auto;border:1px solid #ded6e8">
            <p style="margin:7px 0 0;color:#655d78;font-size:11px">The same ticket is attached as ${escapeHtml(image.filename)} for saving or printing.</p>
          </div>`;
      }
      return `
          <div style="margin-top:16px;border:1px solid #ded6e8;background:#fffaf0">
            <div style="padding:16px 18px;background:#079669;color:#ffffff">
              <span style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Ticket ${index + 1} of ${registered.length}</span>
              <h3 style="margin:6px 0 0;font-size:20px">${escapeHtml(ticket.ticket_type)}</h3>
            </div>
            <div style="padding:18px">
              <p style="margin:0;font-size:12px;color:#655d78;text-transform:uppercase;letter-spacing:.1em;font-weight:700">Attendee</p>
              <p style="margin:5px 0 0;font-size:17px;font-weight:800;color:#241b3f">${escapeHtml(ticket.attendee_name || '')}</p>
              <p style="margin:3px 0 0;font-size:13px;color:#655d78">${escapeHtml(ticket.attendee_email || '')}</p>
              <p style="margin:18px 0 0;font-size:12px;color:#655d78;text-transform:uppercase;letter-spacing:.1em;font-weight:700">Entry code</p>
              <p style="margin:6px 0 0;padding:12px;background:#ffffff;border:1px dashed #079669;font-family:monospace;font-size:17px;font-weight:800;letter-spacing:.08em;color:#241b3f">${escapeHtml(ticket.display_code || '')}</p>
            </div>
          </div>`;
    })
    .join('');
  const textTickets = registered
    .map(
      (ticket, index) =>
        `Ticket ${index + 1}: ${ticket.ticket_type}\nAttendee: ${ticket.attendee_name} (${ticket.attendee_email})\nEntry code: ${ticket.display_code}`,
    )
    .join('\n\n');

  return {
    subject: `Your tickets for ${details.eventTitle}`,
    ticketUrl,
    idempotencyKey: ticketEmailIdempotencyKey(details.orderReference),
    attachments: ticketImages.map((image) => ({
      content: image.content,
      filename: image.filename,
      content_type: image.contentType,
      content_id: image.contentId,
    })),
    text: `Your Naija Tickets booking is confirmed\n\n${details.eventTitle}\n${timing.date}\n${timing.time} ${details.eventTimezoneLabel}\n${details.eventVenue}, ${details.eventCity}\n${details.eventAddress}\n\n${groupMessage}\n\n${textTickets}\n\nOpen your booking securely: ${ticketUrl}\n\n${receipt}\nOrder ${details.orderReference}\nKeep this private ticket link and every entry code secure.`,
    html: `
      <div style="margin:0;background:#fffaf0;padding:24px 12px;font-family:Arial,sans-serif;color:#241b3f">
        <div style="max-width:640px;margin:auto;background:#ffffff;border:1px solid #ded6e8">
          <div style="padding:26px 28px;background:#241b3f;color:#ffffff">
            <p style="margin:0;color:#55e0b2;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Payment confirmed</p>
            <h1 style="margin:12px 0 0;font-size:30px;line-height:1.15">Your Naija Tickets booking is confirmed</h1>
          </div>
          <div style="padding:28px">
            <h2 style="margin:0;font-size:24px;line-height:1.2">${escapeHtml(details.eventTitle)}</h2>
            <p style="margin:12px 0 0;color:#655d78;line-height:1.65">
              <strong style="color:#241b3f">${escapeHtml(timing.date)}</strong><br>
              ${escapeHtml(timing.time)} ${escapeHtml(details.eventTimezoneLabel)}<br>
              ${escapeHtml(details.eventVenue)}, ${escapeHtml(details.eventCity)}<br>
              ${escapeHtml(details.eventAddress)}
            </p>
            <p style="margin-top:16px;font-size:14px;font-weight:700">${escapeHtml(receipt)}</p>
            <a href="${escapeHtml(ticketUrl)}" style="display:inline-block;margin-top:22px;background:#ff6b4a;color:#ffffff;padding:14px 18px;text-decoration:none;font-weight:800">Open your booking and tickets</a>
            <p style="margin:12px 0 0;color:#655d78;font-size:12px;line-height:1.5">This private link gives access to the issued tickets. Do not forward it.</p>
            <p style="margin-top:20px;color:#079669;line-height:1.6">${escapeHtml(groupMessage)}</p>
            <div style="margin-top:26px">${ticketCards}</div>
            <p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #ded6e8;color:#655d78;font-size:12px;line-height:1.6">
              Order ${escapeHtml(details.orderReference)}. Keep each entry code private and show the matching QR code at the venue.
            </p>
          </div>
        </div>
      </div>`,
  };
}
