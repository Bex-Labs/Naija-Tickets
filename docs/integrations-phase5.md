# Phase 5 — Embedded ticket selection

Implemented and locally verified on 16 October 2026. Public sandbox deployment and a real online widget purchase are still pending. Phase 6 has not started. This guide is additive to the [Phase 3 hosted checkout](integrations-phase3.md) and [Phase 4 webhook](integrations-phase4.md) contracts; their pending acceptance gates remain pending.

## What the widget does

An organiser can opt an application into public ticket selection under **Developers & Integrations → Embedded ticket checkout**. Choose Test or Live, enable the widget, optionally allow secure popup checkout, save, select an assigned published event and copy its snippet. Register the external website's exact origin under the same environment first. Only explicitly authorised integration managers can change these settings.

The external website displays the event, current ticket prices, simple quantity selectors, an optional promo code and an advisory subtotal/admission count. Selecting two group-of-five passes means ten admissions. The buyer clicks **Secure checkout** to open a Naija Tickets payment popup while the host page stays open. The existing hosted checkout, reservation, free booking, Paystack verification, group claim, QR, account and webhook paths remain authoritative. Loading a widget or creating a checkout session does not hold inventory; the normal reservation step does.

The public `nt_widget_…` identifier is safe to put in a webpage. It is **not an API key** and cannot authenticate private REST requests. Widget permission is a separate, explicit per-application/per-environment grant. Enabling it does not add scopes to API keys, and disabling it does not disable ordinary API-key checkout.

```html
<div
  data-naija-widget="nt_widget_REPLACE_WITH_YOUR_PUBLIC_WIDGET_ID"
  data-event="REPLACE_WITH_ASSIGNED_EVENT_UUID"
  data-environment="test"
></div>
<script src="https://YOUR_SANDBOX_HOST/integrations/widget-v1.js" defer></script>
```

Replace all placeholders with dashboard values and the separate sandbox deployment. Never put a secret key, buyer details or payment information in the snippet. Live snippets must use the intended live deployment and `data-environment="live"`; test business data must stay in the isolated sandbox.

Optional `data-return-url="https://partner.example/complete"` must have the same origin as the embedding page and a simple path, without query, fragment, credentials, percent escapes or backslashes. By default, return uses the embedding page's origin and pathname, discarding its query and fragment. The loader obtains the actual parent origin from the browser; callers cannot use a query parameter to bypass the server's registered-origin and CSP checks.

Multiple containers may use the same loader. It mounts once per container. A website that later adds containers can call `window.__naijaWidgetV1.mount()` after adding them. Keep a single Naija deployment origin per page. A fallback **Open ticket selection** link opens the same public selection in a new tab if embedding/navigation is restricted. Include the parent website's own ordinary event link or support text if JavaScript is unavailable.

## Security and browser behaviour

- Each read requires an active application, current explicit manager permission, an enabled widget in the deployment's actual resource mode, an exact registered website origin, and a granted event belonging to the same organiser. Draft, ended, removed and other organisers' events are unavailable. An ongoing published event is allowed until its end. Sale windows, pricing, per-tier limits and capacity are checked again by the existing reservation engine.
- The standalone iframe route has its own HTML/CSS/JavaScript. It does not load the app layout, visitor tracker, login session or customer storage. Its content is only the existing public event/ticket projections. No attendee, buyer, QR, order reference or private receipt is returned to the parent.
- A valid frame response uses a response-header CSP `frame-ancestors` with the exact registered parent origin. Other app/checkout pages retain their frame restrictions. An invalid frame fails closed with `frame-ancestors 'none'` and `X-Frame-Options: DENY`. If a partner wraps the widget in additional frames, every ancestor must satisfy that policy; a generic site-builder preview frame may therefore be blocked.
- The loader sandbox permits scripts, forms and a user-initiated popup. A native form with `target="naija_ticket_checkout"` preserves the click/keyboard activation. On verified payment the popup returns a minimal session ID/status/environment signal to the isolated frame, which forwards it to the host as `naijaTicketsCheckoutComplete`. No private checkout capability, QR, attendee information or payment data is sent to the parent.
- The only cross-frame message is `naija:widget:resize:v1`. The loader checks the exact Naija origin, frame window, random per-frame channel and integer height from 260 to 1200 pixels. It ignores arbitrary navigation, foreign, malformed or unrelated messages.
- The public frame uses `Referrer-Policy: strict-origin`, which sends an origin without a path/query. This is necessary for the native form's same-origin `Origin` header. `no-referrer` made this form's origin `null` in the actual browser test and was corrected. The initial iframe navigation still uses `no-referrer`; the private handoff and existing checkout pages retain `no-referrer`. See [MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy) and [MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).
- The form carries a five-minute, purpose-separated signed selection proof bound to the public widget, event, environment, configuration revision, parent origin, return path and nonce. It is not a credential for private APIs. The server requires the Naija origin, rejects secret Authorization headers, limits the URL-encoded body to 16 KiB/five seconds, and accepts only the proof, promo code and distinct ticket quantities. Customer IDs, prices and payment fields are rejected. Selection limits remain 20 tiers, 20 packages per tier and 400 admissions.
- An idempotency digest derived from the signed nonce reuses the existing session after duplicate submission/response loss. A changed selection using the same proof conflicts; refresh the widget for a fresh selection. Expired proofs require refresh. A session lasts up to 30 minutes; the ordinary reservation has its existing shorter limit. Unclaimed paid group admissions never return to inventory merely because they are unclaimed.
- Widget saves increment the configuration revision and block new unpaid actions from old selections/sessions. Disabling the widget, removing an origin/event grant, disabling the app or revoking manager permission also blocks unpaid work. Removing a manager pauses their widgets; granting permission again does not automatically re-enable them. Previously authorised provider payments still complete safely, and paid buyers retain receipt access.
- Requests are private/no-store, have `X-Request-ID`, and log only fixed route/status/duration/request-ID metadata. Shared database budgets are per minute: 600 global, 60 per trusted deployment IP where available; reads 120/application and 300/organiser; checkout creation 10/application and 30/organiser. Limits fail closed and use 429/Retry-After; infrastructure failure uses 503. Both read and creation budgets apply to a handoff. Prices/availability are advisory, not an inventory reservation or proof of payment.

## Routes and contract

See the additive [Phase 5 OpenAPI](integrations-phase5-openapi.json).

| Route | Behaviour |
| --- | --- |
| `GET /embed/events/{eventId}` | Public iframe HTML. Loader supplies `widget`, `environment`, `parent_origin`, `return_url` and `channel`. Validates the current grants and emits an exact frame policy. No credential or cookies required. |
| `GET /api/integrations/widgets/{widgetId}/events/{eventId}?environment=test` | Optional public configuration JSON with only `data.widget_id`, `environment`, `checkout_enabled`, the public event and ticket types. Each tier includes `max_packages_available`, capped at 20. Requires the actual registered `Origin` header, rejects Authorization and unknown/duplicate query fields. No proof or private URL is returned. |
| `OPTIONS` on the public JSON route | Allows only GET without custom request headers, after the same origin/event/configuration validation. Exact-origin CORS, no wildcard or credential permission. `X-Request-ID` is exposed. |
| `POST /integrations/widget-checkout` | Native browser form only. Verifies proof/current settings and creates/replays the existing hosted session, then returns 303 to the signed top-level hosted URL. The existing middleware exchanges access into a first-party HttpOnly cookie and cleans the URL. Errors are frame-denied HTML, with no raw database/provider details. |
| `GET /api/organiser/integrations/{id}/widget?environment=test` | Confirmed organiser JWT plus explicit management grant. Returns settings, revision and canonical `widgetOrigin`; defaults disabled without creating a row. |
| `PATCH /api/organiser/integrations/{id}/widget` | Same protected management surface. JSON: `environment`, `enabled`, `checkoutEnabled`; booleans required. Uses the normal `data`/`meta.request_id` management envelope. |

Public JSON `checkout_enabled` reports the organiser's grant. The HTML form additionally requires hosted checkout/signing server configuration. Neither indicates that Paystack connectivity or a payment has been verified. A return parameter such as `nt_status=paid` is not proof of purchase: a partner server must use its separately scoped `orders:read` key and the existing checkout-session status endpoint. It can read widget sessions belonging to that application. Keep that key on the server and never accept browser assertions as payment verification.

## Database and deployment

Migration: `supabase/migrations/202610160002_integration_widgets.sql`. Apply after Phase 1–4 migrations, including the Phase 4 manager helper. It adds one private `integration_widgets` table and nullable widget actor columns on existing hosted sessions. A check constraint permits exactly one source: an existing API key, or a widget configuration/revision/origin. Private browser database roles cannot access the table or RPCs.

The previous session creation validation/storage is shared in one service-only core; the existing API signature remains a compatibility wrapper. Current actor checks support either source in existing unpaid hosted actions. There is no replacement order, payment, capacity, attendee, QR or refund ledger. Existing API-source rows are preserved. No customer data is deleted or backfilled.

Activation checklist for the **separate sandbox**, before considering live rollout:

1. Review/rehearse the migrations there and deploy this source as its own backend. Do not point the Partner Demo at the main database/site to substitute for an isolated sandbox. No remote migration or deployment was performed by Phase 5.
2. Configure the matching test Supabase values, explicit test resource binding, Paystack `sk_test_` and trusted HTTPS `APP_URL` using the Phase 3 guide. Keep existing dedicated hosted signing settings private. The widget proof uses the same bounded signing key ring with a distinct purpose; no frontend signing secret is introduced.
3. Add server-only `INTEGRATIONS_WIDGETS_ENABLED=true`. It defaults disabled. Set `INTEGRATIONS_CHECKOUT_ENABLED=true` and valid signing settings only when ready to test checkout. Widget reads can remain public while hosted checkout is disabled. The `.env.example` contains only the new disabled flag; no real environment file was changed.
4. In that sandbox organiser dashboard, register the external demo's exact Test origin, assign a future published sandbox event and enable its widget/checkout permission. Copy the **sandbox** snippet onto the external site. A production dashboard Test key or widget is not automatically replicated into the sandbox.
5. Complete an ordinary paid test, a free booking and two group-of-five packages through the real public widget. Check API status from the partner server, return to the registered partner page, correct payment/fees, ten group slots, one-time claim QR/entry and no duplicate callback issuance. Check cancel/expiry, concurrent last inventory, application/origin/grant/revision disable and failed payment. Keep real payments disabled during this acceptance.
6. Check Chrome/Safari and physical iOS/Android, slow network, keyboard, third-party cookies blocked, restrictive parent CSP/site-builder embedding, multiple frames, stale form refresh and an unregistered ancestor. Confirm the external site's CSP permits the Naija script/frame, and its sandbox permits user-initiated top navigation. Do not weaken private checkout framing.
7. Complete the separate Phase 4 durable public receiver and observed Hobby cron/retry gates. The reference SQLite receiver is for a persistent server, not durable storage on Vercel. Email remains deferred by the user. Record actual deployment evidence before marking these gates accepted.

## External example and repeatable checks

`examples/widget` is a static external example with a public-ID setup form and width controls. Serve it over HTTP(S), not `file://`:

```sh
python3 -m http.server 3015 --bind 127.0.0.1 --directory examples/widget
```

Open `http://127.0.0.1:3015`, enter the intended Naija deployment origin, public widget ID and event UUID, and select Test. Register exactly that parent origin in the sandbox. `localhost` and `127.0.0.1` are different origins; scheme/port also matter. Refresh to configure another deployment.

A separate test-only browser fixture is available:

```sh
NAIJA_WIDGET_BROWSER_FIXTURE=1 node scripts/widget-browser-fixture.ts
```

It rejects production, uses fictitious in-memory PostgreSQL data and serves the external example at `http://localhost:3015`, real widget handlers/assets at `http://127.0.0.1:3016`, and an unregistered embedding test at `http://127.0.0.1:3017`. Its final hosted landing is explicitly a **test stub**: it proves session creation and top-level handoff, not real provider payment or production middleware acceptance. It needs no real service/API/Paystack credentials. Stop it after testing; it creates no remote business data.

Final results and operational limitations are recorded in [the progress document](integrations-progress.md). No new dependency, paid service, remote migration, production environment change, public deployment or real charge was introduced. Stop before Phase 6.
