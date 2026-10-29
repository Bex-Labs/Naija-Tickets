export type DeveloperGuide = {
  title: string;
  intro: string;
  sections: { heading: string; body: string[]; code?: string }[];
};
export const developerGuides: Record<string, DeveloperGuide> = {
  'no-code': {
    title: 'Add a Buy Tickets button without coding',
    intro:
      'Create a checkout link, copy it and paste it into a button on your website. You do not need an API key or your own payment backend.',
    sections: [
      {
        heading: '1. Choose where to test',
        body: [
          'Use your organiser account on the separate Naija Tickets sandbox for Test purchases. The main website and sandbox have separate accounts, events and connections. Test mode never permits access to live business data.',
          'Create and publish your event, with its ticket types, on the same platform where you create the checkout link. For real purchases later, the main platform must have Live payments and hosted checkout configured by its administrator.',
        ],
      },
      {
        heading: '2. Save your website connection',
        body: [
          'Open Developers & Integrations in your organiser workspace and choose New application. Application simply means the website you are connecting: give it a recognisable name.',
          'Add your website address under Test website origins when testing, or Live website origins for real sales. Use only the scheme and hostname, for example https://my-website.example; no page path. Local testing can use http://localhost:3001. A deployed website can still use Test mode.',
          'Under Events this application may access, tick the events this website should sell and press Register application or Save integration. Changes are only applied when saved. Unticked events stay unavailable through this connection; their public Naija Tickets pages are independent.',
        ],
      },
      {
        heading: '3. Create your checkout link',
        body: [
          'In Create a Buy Tickets link, choose a saved, published event and Test or Live. Enter the page on your registered website where buyers should return, such as https://my-website.example/thank-you. Press Create checkout link, then Copy checkout link.',
          'If hosted links are not active or the sandbox is not configured, ask the platform administrator to enable them before sharing a link. Creating a connection does not activate missing platform services.',
        ],
      },
      {
        heading: '4. Add it to your website',
        body: [
          'Open the editor for your website, add a button and label it Buy Tickets. In the button settings choose Website address or Link and paste the checkout link. Save and publish your website. The same link can also be shared by email, WhatsApp or social media.',
          'Skip API credentials, webhooks and the HTML snippet for this method. If your builder only accepts a custom HTML block, the optional HTML button is available below the checkout link.',
        ],
      },
      {
        heading: '5. Check the complete purchase',
        body: [
          'Click the published button. Customers select tickets, provide their details and pay on the focused Naija Tickets checkout. Naija Tickets verifies payment before showing tickets. Buyers can then return to your approved website.',
          'In the sandbox, use Paystack Test payment details and confirm the booking in your organiser dashboard. Repeat with an ordinary ticket and a group ticket if you sell both. Test cancellations and sold-out tickets too.',
          'Your website does not need a backend for this button. Ticket records, inventory, verification and group claims remain on Naija Tickets. Ticket emails depend on email service configuration. A personalised payment confirmation on your own website needs a developer to verify the result through the API; a return URL alone does not prove payment.',
        ],
      },
      {
        heading: '6. Change or stop selling',
        body: [
          'Disable the checkout link to block new and unpaid checkouts from that link. To remove an event from the whole connection, untick it and save the integration. Existing paid tickets and purchase history remain available under the normal ticket rules.',
          'Keep this event list: it is the permission boundary for this website’s API keys, hosted links and widgets. One API key does not grant access to all your events. A successful connection check only identifies the application and its permissions.',
        ],
      },
    ],
  },
  'getting-started': {
    title: 'From your website to a verified ticket',
    intro:
      'Start with an isolated test application. Your backend creates a hosted checkout; Naija Tickets handles the buyer, payment and admission tickets.',
    sections: [
      {
        heading: '1. Use the separate sandbox',
        body: [
          'A Test key is not a separate database. The sandbox must have its own website, Supabase project, Paystack test key and matching resource binding. Ask your platform operator for its HTTPS origin. Never substitute the main Naija Tickets hostname.',
          'Feature availability depends on the chosen deployment. Endpoint documentation describes the implemented contract; it does not mean every deployment has enabled it. For a Buy Tickets button without programming or secret keys, use the no-code guide.',
        ],
      },
      {
        heading: '2. Register an application',
        body: [
          'Sign in as an authorised organiser and open Developers & Integrations. Name the application, register the exact Test website origin and assign a published sandbox event. Only an owner or explicitly delegated integration manager can manage credentials.',
          'An origin is the scheme, hostname and port, such as https://partner.example. It has no path. Test localhost HTTP is allowed; Live origins require public HTTPS. A return URL can add a simple path under that origin.',
        ],
      },
      {
        heading: '3. Create a server key',
        body: [
          'Select integration:read, events:read, tickets:read, availability:read, checkout:write and orders:read for an initial hosted checkout. Add external_events:write only when your website will create and update its own event records through the API. The secret appears once; keep it in your server environment. Rotation preserves scopes; existing keys never acquire new permissions automatically.',
        ],
        code: 'NT_API_BASE=https://YOUR_SANDBOX_HOST\nNT_API_KEY=YOUR_SERVER_TEST_KEY\n# Store in an ignored server environment file; never NEXT_PUBLIC_*.',
      },
      {
        heading: '4. Confirm the connection',
        body: [
          'Call introspection from your backend. Check environment, permissions and configured capability flags, then retrieve an assigned event. Capability flags describe deployment configuration, not payment-provider connectivity or a completed purchase.',
        ],
        code: 'curl "$NT_API_BASE/api/v1/integration" \\\n  -H "Authorization: Bearer $NT_API_KEY"\ncurl "$NT_API_BASE/api/v1/events?limit=20" \\\n  -H "Authorization: Bearer $NT_API_KEY"',
      },
      {
        heading: '5. Buy, verify and reconcile',
        body: [
          'Create a checkout using the checkout guide. Complete Paystack TEST payment in the sandbox, verify status on your server and compare the order and admissions with the buyer/organiser records. Test free and group bookings too. Keep the same idempotency key on retries.',
          'A browser return saying paid is not payment proof. Never deliver access solely from query parameters. Use authoritative session status and signed, durably stored webhooks. Email testing is currently deferred.',
        ],
      },
    ],
  },
  authentication: {
    title: 'Credentials and permissions',
    intro:
      'API secrets identify your server application. They do not identify a signed-in customer and never belong in a browser.',
    sections: [
      {
        heading: 'Send the credential from your server',
        body: [
          'Use Authorization: Bearer with an active nt_test_… or nt_live_… secret. Browser requests carrying Origin are rejected for secret-key endpoints. A public nt_widget_… identifier cannot authenticate private REST operations.',
          'Keys expire, can be revoked or rotated, and remain bound to their application, organiser, environment and current creator permission. Application suspension or event grant removal restricts access immediately at the transactional boundary.',
        ],
        code: 'Authorization: Bearer YOUR_SERVER_SECRET\nContent-Type: application/json',
      },
      {
        heading: 'Choose the narrowest scope',
        body: [
          'events:read, tickets:read and availability:read expose assigned published catalogue information. checkout:write creates hosted sessions; orders:read returns only your application’s results and orders.',
          'tickets:status reads purchased admission state. attendees:read exposes names; attendee email/phone additionally requires attendees:contact. sales:read, groups:read and refunds:read expose minimal attributed summaries.',
          'entry:verify permits verification as the key creator; admission also requires entry:check-in. Both require explicit deployment opt-in and current organiser/event authority. No partner admin/refund-write, QR export or machine group-claim capability is advertised.',
        ],
      },
      {
        heading: 'Limits, rotation and revocation',
        body: [
          'Base budgets are 60 requests/key/minute, 180/application and 300/organiser, with global/trusted-IP limits. Hosted creation and entry have additional conservative budgets. On 429, honour Retry-After. Limits fail closed if storage is unavailable.',
          'Rotate a leaked key, remove it from source/logs and revoke the old key. Keep each key in one environment. No administrator receives raw credentials through the integration oversight screen.',
        ],
      },
    ],
  },
  checkout: {
    title: 'Hosted Checkout',
    intro:
      'Keep one reservation and payment engine. Your server supplies ticket choices; authoritative prices, fees, capacity and payment verification remain on Naija Tickets.',
    sections: [
      {
        heading: 'Hosted Checkout Link · no programming',
        body: [
          'In your organiser workspace, open Developers & Integrations, create/select an application, register your website origin and assign the event. Under Hosted Checkout choose the event, Test/Live and an approved return address, then Create checkout link. Copy the link or HTML Buy Tickets button. No API key is needed for this method.',
          'A public event link opens a fresh private checkout session. Buyers select tickets, enter their details, pay and see their tickets on a standalone Naija Tickets page. Disable a link to block new and unpaid checkouts. Paid tickets and refunds keep their normal rules.',
        ],
        code: '<a href="https://YOUR_NAIJA_HOST/checkout/link/YOUR_PUBLIC_LINK_ID">Buy Tickets</a>',
      },
      {
        heading: 'Hosted Checkout API · create a purchase intent',
        body: [
          'POST with checkout:write and a stable Idempotency-Key (8–128 letters/numbers/dots/underscores/hyphens). The same normalized request/key recovers the same session; a different request with that key conflicts.',
          'Send the event UUID. Optional items contains ticket-type UUIDs and package quantities; omit it to let the buyer choose on the hosted page. Optional customer may prefill email/name/phone, and external_reference is a short reference for your own system. Never send price, amount, ownership/customer IDs or attendee records. Return/cancel URLs must use a registered origin plus a simple path, without query, fragment, credentials or escaped paths. Creation does not hold inventory.',
        ],
        code: 'const response = await fetch(`${process.env.NT_API_BASE}/api/v1/checkout-sessions`, {\n  method: "POST",\n  headers: {\n    Authorization: `Bearer ${process.env.NT_API_KEY}`,\n    "Content-Type": "application/json",\n    "Idempotency-Key": purchaseIntentId,\n  },\n  body: JSON.stringify({\n    event_id: eventId,\n    items: [{ ticket_type_id: ticketTypeId, quantity: 2 }],\n    return_url: "https://partner.example/complete",\n    cancel_url: "https://partner.example/cancel",\n  }),\n});\n// Redirect this buyer to result.data.checkout_url.\n// The checkout URL is private: do not log, cache or publish it.',
      },
      {
        heading: 'Let the buyer complete checkout',
        body: [
          'The buyer sees the event artwork, organiser, current ticket choices and fees on a dedicated hosted checkout page, with no marketplace navigation. They can check out as a guest and edit their details. Ordinary tickets retain normal attendee collection; group packages use buyer plus attendee claims. Reservation counts admissions, so two Group-of-5 packages reserve ten places. Prices and availability are checked again transactionally.',
          'Sessions last up to 30 minutes, bounded by key expiry. A reservation lasts up to ten minutes and cannot outlive its session. Use the existing cancel action for an unpaid checkout; cancellation is not a refund. Unclaimed paid group places stay sold.',
        ],
      },
      {
        heading: 'Verify the result on your server',
        body: [
          'After server-verified payment, the hosted confirmation shows tickets and group links plus Return to organiser. That return contains nt_session and a bounded nt_status. Ignore that status as payment proof; query the session with orders:read. Amounts are integer NGN kobo and can be null before reservation. Ticket counts distinguish unclaimed reserved admissions from usable claimed tickets.',
          'Failed, expired or mismatched payments do not issue usable tickets. Duplicate verified callbacks do not issue twice. An already-authorised payment can finish safely after key revocation. Email failure does not invalidate a verified paid booking.',
        ],
        code: 'curl "$NT_API_BASE/api/v1/checkout-sessions/$SESSION_ID" \\\n  -H "Authorization: Bearer $NT_API_KEY"',
      },
    ],
  },
  'external-events': {
    title: 'Sell tickets for an event managed on your own website',
    intro:
      'Your developer can create a private Naija Tickets backing event from your website’s server. It uses the normal inventory, payment, QR and entry system but never appears in the Naija Tickets public event catalogue.',
    sections: [
      {
        heading: '1. Create a connection and a narrowly scoped key',
        body: [
          'In Developers & Integrations, register your website’s exact origin and create a server key with external_events:write. Add checkout:write and orders:read if the same server will start and verify purchases. Assigning ordinary Naija Tickets events remains useful for events that were created inside Naija Tickets; external events are automatically assigned to the application that creates them.',
          'This is a developer integration, not a browser feature. Do not put the secret key, event-creation request or price rules in JavaScript sent to customers.',
        ],
      },
      {
        heading: '2. Create or update the external event from your server',
        body: [
          'Use a stable external ID from your own system, such as event_2026_lagos. Repeating the same request updates that one private backing event rather than creating a duplicate. Tickets need their own stable external IDs. Prices are in NGN kobo: ₦45,000 is 4500000.',
        ],
        code: 'await fetch(`${process.env.NT_API_BASE}/api/v1/external-events/event_2026_lagos`, {\n  method: "PUT",\n  headers: {\n    Authorization: `Bearer ${process.env.NT_API_KEY}`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    title: "Lagos Design Night",\n    description: "An evening of talks and music.",\n    venue_name: "Freedom Park",\n    address: "1 Hospital Road",\n    city: "Lagos", state: "Lagos", timezone: "Africa/Lagos",\n    starts_at: "2026-12-12T18:00:00+01:00",\n    ends_at: "2026-12-12T23:00:00+01:00",\n    tickets: [{\n      external_id: "general", name: "General admission",\n      price_kobo: 4500000, quantity: 100, admissions_per_ticket: 1,\n    }],\n  }),\n});',
      },
      {
        heading: '3. Embed selection and complete payment',
        body: [
          'The successful response contains id: this is the backing event UUID for the public widget snippet or checkout-session API. Enable Embedded ticket checkout in the organiser connection, select the event and copy its snippet to your external page. The customer chooses tickets in the embedded frame; payment opens in a secure Naija Tickets popup so the external website never handles card details.',
          'On verified payment, the popup closes and the loader dispatches naijaTicketsCheckoutComplete on the host page. The event contains only sessionId, status and environment. Send the session ID to your server and use orders:read before displaying a final order confirmation. This avoids trusting a browser message as payment proof.',
        ],
        code: 'window.addEventListener("naijaTicketsCheckoutComplete", async (event) => {\n  const { sessionId, status } = event.detail;\n  if (status !== "paid") return;\n  // Call YOUR server. It verifies this session with Naija Tickets using orders:read.\n  await fetch(`/api/tickets/confirm?session=${encodeURIComponent(sessionId)}`);\n});',
      },
      {
        heading: '4. Keep updates safe',
        body: [
          'Changing a ticket price or people-admitted count is refused after an order exists. Reducing capacity below sold or currently reserved admissions is also refused. Remove a ticket from a later update to stop new sales; existing orders and tickets remain intact.',
          'Naija Tickets verifies availability, fees, payment and ticket issuance on its server. Use signed webhooks or an orders:read status check for your own database, never a client-side price or success screen.',
        ],
      },
    ],
  },
  widget: {
    title: 'Embed ticket selection',
    intro:
      'Copy a public snippet from the organiser dashboard. The isolated iframe selects tickets and opens secure checkout in a small Naija Tickets popup over the same external website.',
    sections: [
      {
        heading: 'Generate your snippet',
        body: [
          'Register the external website’s exact origin, assign an event, choose Test/Live and explicitly enable its widget. Enable hosted checkout separately when the deployment is ready. Copy the generated snippet. Never place an API secret in it.',
        ],
        code: '<div data-naija-widget="YOUR_PUBLIC_WIDGET_ID"\n     data-event="YOUR_ASSIGNED_EVENT_UUID"\n     data-environment="test"></div>\n<script src="https://YOUR_SANDBOX_HOST/integrations/widget-v1.js" defer></script>',
      },
      {
        heading: 'Keep the purchase secure',
        body: [
          'The frame exposes public event/ticket information only, uses exact registered ancestors and isolates host CSS. Buyer details and payments stay in the trusted Naija Tickets popup. After a verified payment, the popup closes and the host receives a naijaTicketsCheckoutComplete browser event containing only a session ID, paid status and environment. No private checkout link, attendee or QR data is sent to the parent.',
          'The default return URL uses your page origin/path and drops queries/fragments. Optional data-return-url must be a same-origin simple URL. If you add containers dynamically, call window.__naijaWidgetV1.mount(). Use orders:read on your server to verify the browser event before showing your final confirmation. Use one Naija deployment origin per page.',
        ],
      },
      {
        heading: 'Unavailable or expired selections',
        body: [
          'Sold-out/end/draft/unassigned events and unregistered embedding websites fail closed. Selection proofs expire after five minutes; refresh the widget for a fresh selection. A fallback link opens public ticket selection in a new tab.',
          'Choose Light or Dark, a Green/Blue/Violet primary palette and Rounded or Square buttons in the snippet generator. The generated data-appearance, data-accent and data-button attributes are validated options; arbitrary CSS or scripts are never accepted. Restrictive host CSP or extra site-builder frames can block the iframe or top navigation.',
        ],
      },
    ],
  },
  webhooks: {
    title: 'Signed notifications',
    intro:
      'Outgoing notifications use a durable transactional outbox. Delivery is at least once, so your receiver must verify and deduplicate.',
    sections: [
      {
        heading: 'Configure a receiver',
        body: [
          'In Developers & Integrations, register its exact HTTPS origin, create a webhook endpoint and select supported events. Save the dedicated endpoint signing secret when shown once. It is different from your API key, hosted signing secret and encryption master key.',
          'Supported events: order.created, order.paid, group.admissions_reserved, ticket.issued, ticket.checked_in, refund.completed. A group slot reservation is not a usable ticket; ticket.issued occurs when a group member claims.',
        ],
      },
      {
        heading: 'Verify raw bytes before parsing',
        body: [
          'Check naija-webhook-id, naija-webhook-timestamp and naija-webhook-signature. Compute HMAC-SHA256 of ID.timestamp.rawBody, prefix the hexadecimal signature with v1=, compare in constant time and allow at most 300 seconds of clock skew. Verify integration ID, environment, API version and event type too.',
        ],
        code: 'import { createHmac, timingSafeEqual } from "node:crypto";\nconst expected = createHmac("sha256", endpointSecret)\n  .update(`${eventId}.${timestamp}.${rawBody}`).digest();\n// Validate exact header formats and timestamp window first.\nconst supplied = Buffer.from(signature.slice(3), "hex");\nconst valid = supplied.length === expected.length &&\n  timingSafeEqual(supplied, expected);',
      },
      {
        heading: 'Acknowledge only after durable recording',
        body: [
          'Insert the immutable event ID and payload hash into a durable inbox transaction before returning 2xx. Identical duplicates succeed without repeating business effects; conflicting ID/body pairs must not. Return a retryable failure if durable storage is unavailable.',
          'Do not use an in-memory map or local SQLite on Vercel as durable storage. The repository’s SQLite receiver example is for a persistent server. Partner Demo’s public durable receiver still requires configuration and verification.',
        ],
      },
      {
        heading: 'Daily Hobby dispatch and recovery',
        body: [
          'The initial Hobby schedule is daily at 04:00 UTC, bounded to twenty delivery attempts per invocation. Timing is not exact and a failed cron invocation is not automatically retried by Vercel. This is not real-time delivery.',
          'Failures use persisted leases, exponential backoff and bounded attempts. Inspect delivery history, fix the cause and use manual retry when eligible. Duplicate/out-of-order notifications remain possible. Alert on exhausted deliveries and growing oldest-pending age; do not infer a payment failure merely from a missing notification.',
        ],
      },
    ],
  },
  sandbox: {
    title: 'Isolated testing and rollout',
    intro:
      'Use three separate projects: main Naija Tickets, the sandbox backend and the external Partner Demo. Keep test resources out of the main database.',
    sections: [
      {
        heading: 'Separate resources',
        body: [
          'The sandbox requires its own public HTTPS website, Supabase project and Paystack sk_test_ secret. Both deployment and stored database binding must match the test project and differ from live. Production dashboard Test credentials are not replicated into the sandbox.',
          'Partner Demo rejects the main hostname and Live credentials. Its API key/session secret stay on its server; it does not need the Naija service-role or payment key. Never copy production customers or use test data to inflate main sales.',
        ],
      },
      {
        heading: 'Acceptance checklist',
        body: [
          'Read the deployment runbook and readiness report. Rehearse migrations in a disposable database, then review the exact pending sandbox migration list. Do not reset either database. Configure only the intended sandbox environment.',
          'From the external demo, authenticate, retrieve a real sandbox event, select tickets, complete Paystack TEST payment, verify the session/order on the server and return to the demo. Repeat free and group purchases; test claim uniqueness, individual QR and one-time entry, cancellation, expiry, revocation and refunds.',
          'Confirm the public widget at mobile/desktop widths, keyboard navigation and blocked third-party cookies. Configure a durable receiver, test altered/replayed signatures and observe an actual scheduled delivery/recovery. Record which checks actually ran. Email remains deferred.',
        ],
      },
      {
        heading: 'What is still pending here',
        body: [
          'The public sandbox backend/purchase/return, durable public webhook inbox and observed daily cron acceptance are not yet certified. Local mocked/embedded database tests and a successful build do not substitute for them.',
          'Use /developers/readiness for the operator checklist. Do not enable Live flags merely because the source is deployed. A real settlement, physical device/camera test and security/throughput review remain separate operational checks.',
        ],
      },
    ],
  },
  security: {
    title: 'Security and support',
    intro:
      'Keep a small integration boundary and collect only the customer information your application is authorised to handle.',
    sections: [
      {
        heading: 'Protect secrets and capabilities',
        body: [
          'Keep API, provider, service-role, signing, cron and encryption keys in server environments, with separate test/live material. Never prefix secrets NEXT_PUBLIC_, include them in URLs or send them to browser analytics. Rotate exposed secrets and revoke compromised credentials.',
          'Checkout, receipt, invitation and private member-ticket URLs are bearer capabilities. Do not log or publish them. Use HTTPS and private/no-store handling for booking results. Public widget IDs identify an application and do not grant private access.',
        ],
      },
      {
        heading: 'Minimise attendee information',
        body: [
          'Default order/ticket reads contain no names/contact/QR. Attendee names and contact have separate opt-in scopes; erased data stays null. Retain only what you need, restrict your own staff and honour erasure and revocation.',
          'Group duplicate-email/phone checks are not verified-human identity. Do not advertise them as protection against a person claiming with two entirely different contacts. Keep claims in the supported buyer/attendee flow.',
        ],
      },
      {
        heading: 'Investigate an error safely',
        body: [
          'Keep the request ID, operation, approximate time, environment and safe error code. Do not attach credentials, QR codes, private URLs or buyer/attendee details to a public report.',
          'Unknown-key failures stay in safe server logs; authenticated request counts are retained for about 30 days with bounded cleanup. Admin oversight displays safe activity and exhausted delivery counts. Review application suspension and creator/event permissions before reissuing credentials.',
        ],
      },
    ],
  },
  faq: {
    title: 'Frequently asked questions',
    intro: 'Practical answers for partners building their first integration.',
    sections: [
      {
        heading: 'Why does a Test key say sandbox not configured?',
        body: [
          'Test prefixes do not isolate a live database. Use the separate sandbox host with its matching Test key, project binding and test payment configuration. Ask the operator to verify configuration; do not swap in production data.',
        ],
      },
      {
        heading: 'Does the API sell every organiser’s event?',
        body: [
          'No. An application sees only its currently assigned events owned by its organiser. Advanced history is narrower still: only purchases attributed to that application. A valid key alone does not grant private customer access.',
        ],
      },
      {
        heading: 'Why is the widget unavailable?',
        body: [
          'Check the actual embedding origin including scheme/port, selected environment, app/widget enablement, current manager/event grant, event publication/end and server flags. Refresh an expired five-minute form. Extra ancestors and restrictive host CSP can block framing.',
        ],
      },
      {
        heading: 'Why is an order paid but no member QR exists?',
        body: [
          'A group payment reserves sold admission slots immediately. Members must claim through the normal registration flow before each gets a usable QR. Unclaimed admissions do not return to inventory.',
        ],
      },
      {
        heading:
          'Can my application issue refunds or admit marketplace tickets?',
        body: [
          'No partner refund write or admin bypass is exposed. Delegated entry requires explicit scopes and creator/event authority and is limited to this application’s own purchases. Use the ordinary authorised venue workflow for wider entry operations.',
        ],
      },
      {
        heading: 'How fast will a webhook arrive?',
        body: [
          'The initial free/Hobby dispatcher runs daily with twenty attempts per invocation. There is no prompt-delivery SLA. Poll the authoritative server status for a purchase confirmation and use a durable signed inbox for eventual notifications.',
        ],
      },
      {
        heading: 'Can I test without email or a custom domain?',
        body: [
          'Email is currently deferred. A separate HTTPS deployment origin can host the sandbox; tickets remain available through the existing verified buyer pages. Configure a verified email sender only when ready to test controlled recipients.',
        ],
      },
    ],
  },
};
