import { escapeWidgetHtml as escape } from './widget-snippet.ts';
import { signWidgetProof } from './widget-proof.ts';
import {
  readWidget,
  parseWidgetSelection,
  widgetBudget,
  widgetCheckout,
  widgetFailure,
  widgetRoute,
  type WidgetDependencies,
  type PublicWidgetSnapshot,
} from './widget.ts';
import type { WidgetSelection } from './widget-types.ts';
export function widgetHeaders(parent?: string): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'text/html; charset=utf-8',
    // Native form POSTs under no-referrer send Origin:null. The public frame
    // sends only its origin; private hosted checkout keeps no-referrer.
    'Referrer-Policy': parent ? 'strict-origin' : 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors ${parent || "'none'"}`,
    ...(parent ? {} : { 'X-Frame-Options': 'DENY' }),
  };
}
function document(title: string, content: string, script = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Naija Tickets</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/integrations/widget-v1.css">${script ? '<script src="/integrations/widget-frame-v1.js" defer></script>' : ''}</head><body>${content}</body></html>`;
}
export function renderWidget(
  data: PublicWidgetSnapshot,
  selection: WidgetSelection,
  proof: string | null,
  origin: string,
) {
  const money = (price: number) =>
    new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price / 100);
  let date = '';
  try {
    date = new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.event.timezone,
    }).format(new Date(data.event.starts_at));
  } catch {
    date = new Date(data.event.starts_at).toUTCString();
  }
  const tickets = data.tickets
    .map((ticket, index) => {
      const maximum =
        ticket.sale_status === 'open' ? ticket.max_packages_available : 0;
      const quantities =
        maximum >= ticket.min_packages_per_order
          ? Array.from(
              { length: maximum - ticket.min_packages_per_order + 1 },
              (_, i) => i + ticket.min_packages_per_order,
            )
          : [];
      return `<div class="ticket"><div class="ticket-copy"><label for="ticket-${index}">${escape(ticket.name)}</label>${ticket.description ? `<p>${escape(ticket.description)}</p>` : ''}<span class="ticket-meta">${ticket.admissions_per_ticket > 1 ? `Admits ${ticket.admissions_per_ticket} people per pass` : 'One admission per ticket'}${ticket.price_kind === 'early_bird' ? ' · Early bird' : ''}</span><strong>${escape(money(ticket.price_kobo))}</strong></div><div class="quantity"><label class="sr-only" for="ticket-${index}">Quantity for ${escape(ticket.name)}</label><select id="ticket-${index}" name="quantity_${escape(ticket.id)}" data-price="${ticket.price_kobo}" data-admissions="${ticket.admissions_per_ticket}"${!quantities.length || !proof ? ' disabled' : ''}><option value="0">0</option>${quantities.map((n) => `<option value="${n}">${n}</option>`).join('')}</select>${!quantities.length ? `<span class="sale-state">${ticket.sale_status === 'sold_out' ? 'Sold out' : ticket.sale_status === 'upcoming' ? 'Not on sale' : ticket.sale_status === 'closed' ? 'Sales ended' : 'Unavailable'}</span>` : ''}</div></div>`;
    })
    .join('');
  return document(
    data.event.title,
    `<main class="widget" data-appearance="${escape(selection.appearance || 'light')}" data-accent="${escape(selection.accent || 'green')}" data-button="${escape(selection.button || 'rounded')}" data-parent-origin="${escape(selection.parentOrigin)}" data-channel="${selection.channel}"><header class="brand"><img src="/favicon.svg" alt="" width="24" height="24"><span>Naija Tickets</span>${selection.environment === 'test' ? '<span class="test-tag">Test event</span>' : ''}</header><section class="event"><span class="eyebrow">YOU’RE GOING TO</span><h1>${escape(data.event.title)}</h1><p>${escape(date)}</p><p>${escape(data.event.venue.name)} · ${escape(data.event.venue.city)}</p></section><form method="post" action="${escape(origin)}/integrations/widget-checkout" target="naija_ticket_checkout"><input type="hidden" name="proof" value="${escape(proof || '')}"><fieldset><legend>Choose your tickets</legend>${tickets || '<p class="empty">No tickets are available right now.</p>'}</fieldset>${proof ? '<label class="promo-label" for="promo">Promo code <span>(optional)</span></label><input id="promo" name="promo_code" maxlength="32" autocomplete="off" placeholder="Enter code">' : ''}<div class="summary"><span>Total before fees</span><output id="subtotal" aria-live="polite">Select tickets</output></div><p class="fine" id="admissions">Discounts and fees are confirmed at checkout.</p><button type="submit"${!proof || !data.tickets.some((t) => t.sale_status === 'open' && t.max_packages_available >= t.min_packages_per_order) ? ' disabled' : ''}>Secure checkout <span aria-hidden="true">↗</span></button>${!proof ? '<p class="fine">Online checkout is not available for this widget.</p>' : '<p class="fine centre">Checkout opens in a secure popup. This page stays open.</p>'}<noscript><p class="fine">Choose a quantity, then continue. Prices and availability are checked again at checkout.</p></noscript></form></main>`,
    true,
  );
}
export function widgetPageHandler(deps: WidgetDependencies, eventId: string) {
  return widgetRoute(deps, 'widget.embed', async (request: Request) => {
    try {
      if (request.method !== 'GET' || request.headers.has('authorization'))
        return new Response(
          document(
            'Widget unavailable',
            '<main class="widget empty"><h1>Ticket widget unavailable</h1></main>',
          ),
          { status: 405, headers: widgetHeaders() },
        );
      await widgetBudget(deps, request);
      const selection = parseWidgetSelection(new URL(request.url), eventId);
      const { snapshot, data } = await readWidget(deps, request, selection);
      let proof: string | null = null;
      if (data.checkout_enabled) {
        try {
          await deps.requireConfiguration(selection.environment, true);
          proof = signWidgetProof(
            {
              ...selection,
              configurationId: snapshot.actor.widgetConfigId,
              revision: snapshot.actor.revision,
            },
            deps.signingKeys(),
          );
        } catch {
          /* Public event reading remains usable while hosted checkout is disabled. */
        }
      }
      return new Response(
        renderWidget(data, selection, proof, deps.origin(request)),
        { headers: widgetHeaders(selection.parentOrigin) },
      );
    } catch (cause) {
      const error = widgetFailure(cause);
      return new Response(
        document(
          'Ticket selection unavailable',
          `<main class="widget empty"><h1>Ticket selection unavailable</h1><p>${escape(error.message)}</p><p>Return to the event website and refresh the ticket selection.</p></main>`,
        ),
        {
          status: error.status,
          headers: {
            ...widgetHeaders(),
            ...(error.retryAfter
              ? { 'Retry-After': String(error.retryAfter) }
              : {}),
          },
        },
      );
    }
  });
}
export function widgetCheckoutHandler(deps: WidgetDependencies) {
  return widgetRoute(deps, 'widget.checkout', async (request: Request) => {
    try {
      const target = await widgetCheckout(deps, request);
      return new Response(null, {
        status: 303,
        headers: { ...widgetHeaders(), Location: target.href },
      });
    } catch (cause) {
      const error = widgetFailure(cause);
      return new Response(
        document(
          'Choose tickets again',
          `<main class="widget empty"><h1>Choose tickets again</h1><p>${escape(error.message)}</p><p>Return to the event website and refresh the ticket selection.</p></main>`,
        ),
        {
          status: error.status,
          headers: {
            ...widgetHeaders(),
            ...(error.retryAfter
              ? { 'Retry-After': String(error.retryAfter) }
              : {}),
          },
        },
      );
    }
  });
}
