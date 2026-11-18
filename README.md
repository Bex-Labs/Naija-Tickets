# Naija Tickets

An interactive Nigerian event discovery and ticketing platform. The current build includes a polished public homepage, searchable event catalogue, shareable filters, pagination, event details, ticket tier selection, sold out handling, branded account flows, organiser and administrator workspaces, immediate post-payment ticket passes, and a production-ready database foundation.

## Local setup

Requirements: Node.js 24.x and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Public event pages, search, city counts, checkout, and both workspaces use the configured Supabase project as their event source.

Local development uses Vinext's Node.js runtime, supporting
the native `sharp` renderer for ticket email PNGs. After updating the runtime
configuration, stop any existing dev server with Ctrl+C and run `npm run dev`
again. For a local production preview, run `npm run build` followed by
`npm start`. The legacy worker configuration requires explicitly setting
`NAIJA_RUNTIME=cloudflare`; it cannot run native `sharp` ticket image rendering.

## Database setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in the Supabase values.
3. Apply every SQL file in `supabase/migrations` in filename order using the Supabase CLI or SQL editor.
4. Apply `supabase/seed.sql` for the category reference records and default platform-fee record. It does not create organisers or public events.

The migrations cover profiles, server-controlled roles, organiser applications and memberships, events, ordered schedule items, ordered policies, ticket types, orders, order items, reservations, payments, idempotent webhook records, tickets, staff assignments, check-ins, refunds, payouts, platform settings and audit logs. Row-level security is enabled on every application table. Sensitive operational writes intentionally have no browser policy and must run in trusted server code.

Apply `supabase/migrations/202609150004_guest_privacy_and_ticket_email.sql` after the earlier `20260915` migrations. It adds the protected guest-purchase directory, atomic guest PII anonymisation, complete ticket email claims and the database-owned configurable service fee. Existing orders and their stored totals are not recalculated.

Apply `supabase/migrations/202609160001_organiser_profiles_and_catalogue.sql` next. It records whether an organiser operates as an individual or organisation, adds public website and social profile fields, and expands the event category catalogue. Both organiser types use the same event creation, ticket pricing and sales tools.

### Organiser event data

Apply `supabase/migrations/202609150002_event_detail_editor.sql` before using the expanded organiser editor. It migrates legacy schedule and policy JSON into queryable ordered tables and adds presenter, timezone-label and directions fields.

The organiser editor saves the event, organiser profile, ordered schedule, ordered policies and all ticket tiers in one database transaction. Organisers enter prices in NGN; the server converts them to non-negative integer kobo. Existing sold and reserved counts are never accepted from the browser, and capacity cannot be reduced below committed inventory. Public checkout loads the saved ticket price from Supabase and recalculates the order total on the server.

Apply `supabase/migrations/202610100001_early_bird_quantity.sql` before deploying the early bird quantity field. For each paid tier, enable **Offer early bird pricing**, enter the discounted price, deadline and **Early bird tickets available**. This allocation is included in the tier's total quantity; group tiers count packages. The standard price takes over when the allocation is exhausted or its deadline passes. Live checkout reservations hold early bird stock, expired/released reservations restore it, and paid bookings retain their allocation even after refunds. Existing offers remain unlimited until edited. Checkout snapshots the offer on each order item and locks selected tiers before checking the limit, keeping Paystack totals and group admission capacity unchanged.

## Live-service configuration

The `.env.example` file lists the values needed for Supabase, Paystack and transactional email. Keep all service-role, payment and email secrets server-only. The application does not contain a simulated Paystack success path.

### Paystack setup

1. Add `PAYSTACK_SECRET_KEY=sk_test_...` and `APP_URL=http://localhost:3000` to `.env.local`. Start with a Paystack test secret key. Do not add a Paystack key with a `NEXT_PUBLIC_` prefix.
2. Apply `supabase/migrations/202609150001_paystack_payments.sql`. It adds idempotent payment preparation, atomic inventory conversion and exactly-once ticket issuance.
3. In Paystack Dashboard, open **Settings → API Keys & Webhooks** and set the webhook URL to `https://your-domain.example/api/payments/paystack/webhook`.
4. The endpoint processes `charge.success` and safely acknowledges other signed event types. It validates `x-paystack-signature` with `PAYSTACK_SECRET_KEY`; there is no separate webhook secret.
5. For production hosting, add `PAYSTACK_SECRET_KEY` as a secret and `APP_URL` as the exact HTTPS application origin. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only as well.
6. Complete a test payment and confirm the order becomes `paid`, one verified payment is recorded, held inventory moves to sold inventory, and one ticket row is created per attendee before switching to a live key.

If **Continue to payment** fails on Vercel, check the code beside the checkout error and the matching `Paystack initialization failed` function log. `PAYMENT_KEY_MISSING` means `PAYSTACK_SECRET_KEY` is absent; `PAYMENT_PROVIDER_AUTH` means Paystack rejected that key; `PAYMENT_RETURN_URL` means there is no trusted HTTPS return origin; and `PAYMENT_DATABASE_SETUP` means the production Supabase project is missing a payment migration. `PAYMENT_PROVIDER_REJECTED` means Paystack rejected the initialization request for another reason; the server log retains the provider message. Set the values in Vercel's **Production** environment and redeploy before trying again. Do not paste secret keys into logs or support messages.

The browser never sends an amount to Paystack. The initialization endpoint loads the guest or signed-in customer order and total from Supabase. Both the callback and webhook use the same atomic database function, so retries cannot issue tickets twice. A successful payment received after a reservation expires is recorded for support review without consuming inventory or issuing tickets.

After a successful callback, `/payment/status` uses the random 36-character order reference as a private bearer capability. The server validates that reference, confirms the persisted order is paid, and only then reads issued ticket codes. Each ticket is rendered from stored order, event, attendee and ticket-tier data with a scannable QR code. Pending, failed, expired and invalid orders never expose ticket codes. Customers can print the passes or save them as a PDF through the browser.

### Ticket email setup

1. Verify the sending domain in Resend and finish the SPF and DKIM records shown in its dashboard.
2. Create a sending-access API key, then add `RESEND_API_KEY` and an `EMAIL_FROM` address on the verified domain to `.env.local`.
3. Set `APP_URL` to the exact public HTTPS origin in production. For local email testing, keep `APP_URL=http://localhost:3000` for payment callbacks and set `EMAIL_APP_URL=https://naija-tickets.vercel.app` for emailed ticket links. The public site must use the same Supabase project. Without `EMAIL_APP_URL`, emails use `APP_URL`; emailed links always require public HTTPS.
4. Add those same values to production hosting only when the domain is ready. Keep `RESEND_API_KEY` server-only.
5. The paid callback, signed webhook and free-checkout finaliser share one database delivery claim and use a stable Resend idempotency key. A failed delivery remains retryable, while a sent order is not deliberately sent twice.

Email delivery runs as background work and is not required for the post-payment ticket page. The email includes the amount paid, purchase date, order reference, real event date, local time, timezone, venue, ticket tier, attendee and entry code, plus the private link to the server-verified QR ticket page. Verified tickets remain immediately available when Resend is missing or temporarily unavailable.

Ticket email PNGs use bundled Noto Sans fonts converted to vector paths before
rasterisation. They do not depend on fonts installed on the server. The font
files and their SIL Open Font License are in `assets/ticket-fonts`; they are
included only in the server bundle and loaded when ticket images are generated.

The branded confirmation and recovery templates are stored in `supabase/templates`. The hosted authentication service requires custom SMTP or a qualifying paid configuration before those templates and a Naija Tickets sender address can be activated. Use a dedicated authentication sender such as `no-reply@auth.yourdomain.com` with SPF, DKIM and DMARC configured.

### Platform service fee

An authenticated administrator can open **Settings → Service fee** and choose either a percentage of the ticket subtotal or a fixed NGN amount per ticket. Percentage values are stored as integer basis points; fixed values are stored as integer kobo per ticket. The form shows a worked preview and requires the administrator's current password before saving.

The reservation transaction reads the active rule directly from `platform_settings`. It ignores fee values from the browser, applies percentage fees to the subtotal, multiplies fixed fees by ticket quantity, stores the final fee and total on the order, and defaults safely to 5% when the setting is absent or invalid. Paystack then charges that stored total. Every fee change is recorded in `audit_logs`.

### Admin sales analytics

The administrator overview shows verified bookings, tickets sold, ticket revenue, service fees charged, remaining inventory, sales by event category, and the top ten events by ticket revenue. Ticket revenue follows the organiser analytics definition: discounts and completed refunds are applied, service fees are excluded, and fully refunded orders do not count. Service fees are shown before any fee refunds. Active reservations reduce inventory; expired reservations and inactive ticket types do not.

Apply `supabase/migrations/202609200005_admin_sales_analytics.sql` before deploying this dashboard. The analytics function returns one aggregate JSON result without purchaser or attendee details and can only be called with the server role. The HTTP endpoint also requires a valid administrator session.

### Admin visitor counts

The admin overview shows total unique browsers, visitors today and visitors in the last 30 calendar days (including today), using Africa/Lagos time. A random identifier in browser local storage recognises repeat visitors. Only its SHA-256 hash and first/latest visit timestamps are stored; no account information, IP address or page history is recorded. Admin, organiser and event-entry pages, local development and Vercel previews are excluded. Do Not Track, automated browsers and browsers with blocked storage are skipped. Clearing storage or using another browser counts as a new visitor, so these figures estimate visitors rather than identify people.

Apply `supabase/migrations/202610070001_admin_visitor_analytics.sql` and deploy the app to start counting. Earlier traffic cannot be reconstructed. The public recording endpoint accepts only a small visitor-identifier payload; totals are returned only through an authenticated admin endpoint, and browser database roles cannot read or write visitor records or execute either private function. **Refresh visitors** reloads the current totals.

### Organiser sales analytics

The organiser overview displays tickets sold, ticket revenue, remaining inventory, sales by event category and a per-event breakdown. Sales count issued valid or used tickets on paid or partially refunded orders with a verified payment. Ticket revenue is the paid ticket subtotal after promo discounts and completed refunds, excluding service fees; fully refunded orders do not count. Remaining inventory excludes active holds and inactive ticket types, and expired holds are ignored.

Apply migrations `202609200002` through `202609200004` before deploying the dashboard. The aggregation runs in a private database function that checks organiser membership; the API returns only aggregate figures and does not expose attendee or purchaser details. The permission migrations remove direct public access to analytics, promo, payment, and other server-only functions while preserving the role-check functions used by database policies.

### Organiser promo codes

Apply `supabase/migrations/202609200001_promo_codes.sql` to the target database before deploying this version of the app. Checkout now calls `create_checkout_reservation_v3`; the migration preserves the existing reservation and payment functions.

Organisers can open **Promo codes** to create a case-insensitive code for one event, either across all ticket types (including subsequently added tiers) or selected tiers. The form requires a percentage or fixed NGN discount per eligible ticket, WAT start/end dates and a maximum number of bookings. Codes are private, and the database checks organiser membership and ticket ownership before creation.

Customers enter one optional code before reserving tickets. The reservation transaction validates its event, dates, ticket scope and remaining uses, then shows the applied discount and final total before payment. Discounts apply to current prices, including early bird prices. Fixed discounts are capped at each ticket's price; percentage fees use the discounted subtotal and fixed fees remain payable.

Each pending booking holds one use. Expired reservations release that use when checkout releases their inventory; paid and refunded bookings keep their redemption. A row lock serialises bookings for the same code, and remaining pending orders count against the limit to avoid overlooking an in-flight payment. Rejected reservations roll back both inventory and promo use.

Orders retain the original `subtotal_kobo` and a separate `discount_kobo`; the payable amount is `subtotal_kobo - discount_kobo + fee_kobo`. Use the discounted ticket subtotal for organiser settlement. Paystack and free booking both use the stored final total.

`npm test` includes embedded PostgreSQL tests using PGlite against the real reservation, promo and payment SQL, with no hosted database or payment service required.

### Organiser settlement

Checkout uses a Paystack subaccount split when an organiser has connected a payout account; otherwise the charge goes to the platform Paystack account. The buyer service fee is platform revenue. The organiser's ticket proceeds start with verified ticket sales after promo discounts and completed refunds, excluding buyer service fees.

The organiser **Payouts** view shows recorded payout amounts, status, reference, settlement period and relevant dates. Its reconciliation uses verified sales, completed refunds and recorded payout deductions, and is restricted to the signed-in organiser's memberships. The `payouts` table is a manual payout ledger; Paystack split settlement is not confirmed by this ledger. No automatic transfer-status sync or administrator payout-entry workflow exists yet, so a missing payout record is an unassigned estimate rather than proof of unpaid funds. An administrator must reconcile and record transfers before marking them paid.

### Organiser verification

Individual organisers submit a legal name and 11-digit NIN; organisations submit a legal name and CAC registration number from Settings. The form displays the relevant official agency image. The private verification record is available only through authenticated organiser and administrator routes. Administrators review it from **Organisers**, record a decision and note, and may revoke verification. A persistent in-app alert tells the organiser about the decision until dismissed. A green tick appears beside the organiser's name only while verified. New event publication is blocked in PostgreSQL until the organiser is verified; existing published events remain visible. Changing an organiser's name, email, phone or account type removes verification until a new review. Number format checks are not automatic NIMC or CAC registry verification; administrators must confirm identity before approval.

### Guest purchase privacy

The administrator's **Guest buyers** section lists guest purchases with their contact details, event, reference, status, amount, date and ticket count. Search is available across those fields. Personal-data removal requires the current administrator password and an explicit `ERASE` confirmation.

The database operation anonymises purchaser and attendee data in the order, order items, tickets, payment provider payloads and email delivery record in one transaction. It keeps order totals, payment reconciliation, ticket validity, private ticket codes and the audit trail. It never hard-deletes the purchase, and the customer and organiser workspaces cannot call the operation.

## Useful commands

The footer shows Instagram, Facebook, TikTok, and X links. Until official profile URLs are available, these links open each platform's homepage. Set `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_FACEBOOK_URL`, `NEXT_PUBLIC_TIKTOK_URL`, and `NEXT_PUBLIC_X_URL` to the official profile URLs when they are ready.

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Automatic organiser payout records

Apply `supabase/migrations/202609290001_automatic_payout_recording.sql`. The organiser Payouts API now checks Paystack's settlement API automatically on page open; the page checks again every minute while visible. This is an on-demand sync, not a background scheduler. The server rate-limits checks per organiser/subaccount, preserves the last confirmed data on failures, and records the provider's pending, processing, success or failed state. No transfer is initiated by this feature.

Only live NGN settlements whose complete transaction list matches verified payments, recorded split details and organiser earnings can be imported. Provider batches are idempotent, payment allocation is unique, and unknown deductions, missing transactions, conflicting legacy manual records or mismatched amounts are flagged for reconciliation instead of guessed. Fully refunded sales remain in the accounting history. Real-money totals exclude test transactions. Disconnected subaccounts can still be reconciled through the historical split codes on their payments.

The organiser connects a bank under Settings for future split payments. Payments taken without a split account cannot be made into direct settlements retroactively; support must arrange those separately. Test mode displays an explicit notice and never imports simulated payouts. Current production limitations: reconciliation runs when Payouts is open, not while all users are offline, and exceptional deductions require support review. A live bank settlement still needs end-to-end validation when the account is switched from test to live mode.

### Google sign-up activation

The app already starts Google OAuth and retains the selected customer/organiser profile. In the hosted Supabase project, Google is currently disabled. To activate it, create a Google OAuth **Web application** client, register the Supabase project URL followed by `/auth/v1/callback` as the Google authorised redirect URI, then enable Google in Supabase Authentication → Providers using that client ID and secret. Keep the client secret in Supabase, never in browser environment variables or source files.

Add the actual application `/login?oauth=1...` destinations to Supabase's redirect allow list, including the public HTTPS site and any localhost ports used for development (e.g. `http://localhost:3002/login**`). Local `supabase/config.toml` does not enable the provider on the hosted project. Reference: https://supabase.com/docs/guides/auth/social-login/auth-google . The UI checks availability before redirecting so a disabled provider leaves the customer on the login page with an email-sign-in alternative.

For Resend accounts without a domain, `onboarding@resend.dev` can send test emails only to the email address associated with that Resend account. It cannot send customer tickets generally. Add the API key directly to the ignored `.env.local` file; never paste it into chat or commit it. A reachable HTTPS `APP_URL` is still needed for usable ticket links. See https://resend.com/docs/knowledge-base/403-error-resend-dev-domain .

### Verified confirmation emails and retries

Apply `supabase/migrations/202609290002_verified_ticket_emails.sql`. A paid order must also have a matching verified payment before its ticket email can be claimed. Failed, pending, refunded and privacy-erased purchases cannot send valid-ticket confirmations. The confirmation page reads the stored delivery status and offers a retry for unsent mail; it never accepts a replacement recipient address. A delivery claim prevents concurrent sends and failed attempts have a one-minute retry cooldown. Group buyers receive their booking link and a count of admissions awaiting claims; unclaimed slots have no usable admission code.

Email sending is not active until `RESEND_API_KEY`, a verified-domain `EMAIL_FROM` and a reachable HTTPS `APP_URL` are configured. No production email has been sent or mailbox delivery verified as part of the local tests.

### Group member registration options

After a verified group purchase, the buyer opens the booking from the payment confirmation or **My tickets → Manage group tickets**. They can share the group registration link so each attendee enters their own details, or enter each attendee's name, email and phone themselves. Buyer-entered details immediately claim one reserved admission and generate that attendee's individual ticket link, which the buyer can copy or share on WhatsApp. Both options use the same claim endpoint and database checks; the remaining admissions can be filled using either method. A group invitation does not expose other attendees' private ticket links. No additional migration is needed for this UI change.

### Vercel deployment

Import the repository with its root directory set to the directory containing this `package.json`. The checked-in `vercel.json` selects the Nitro framework and `npm run build`; leave any Output Directory override disabled in the Vercel project settings. Nitro writes Vercel's Build Output API to `.vercel/output`, including the server function and the route from `/` to that function. Serving `public` or `dist` as a static folder produces a 404 for app routes.

Set the environment variables listed in `.env.example` in Vercel, with `APP_URL` equal to the public HTTPS deployment URL. Build variables beginning with `NEXT_PUBLIC_` must be set before the build. To verify the deployment output locally, run `VERCEL=1 NITRO_PRESET=vercel npm run build` and inspect `.vercel/output/config.json`.

For production sign-in, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from the **same** Supabase project in Vercel's **Production** environment. The public values are included in the build, so redeploy after adding or changing them. If an organiser's workspace reports that the session cannot be verified, sign out and sign in again on the production domain. The server logs record the Supabase auth error status and code without logging the access token.

Administrators use `/admin` and the **admin login ID**, which is separate from a customer/organiser email login. Set `ADMIN_SESSION_SECRET` and either an existing admin account in that Supabase project's `platform_settings` table or the `ADMIN_USERNAME`, `ADMIN_PASSWORD_SALT`, and `ADMIN_PASSWORD_HASH` environment variables. Stored `admin_accounts` take precedence over environment credentials, so changing the environment password will not replace a password already changed in Admin Settings. Missing deployment settings now return a configuration error instead of claiming the password is incorrect. Do not put administrator or service-role secrets in `NEXT_PUBLIC_` variables.

### Developer integrations — Phase 3

Organiser owners can open **Developers & Integrations** to register applications, website origins and event assignments, then generate, rotate or revoke test/live server keys. Apply migrations `202610130001_integration_foundation.sql` and `202610140001_integration_event_reads.sql` to other target Supabase projects before deploying. Secrets are shown once and stored as digests. Keys default to `integration:read`; explicitly add `events:read`, `tickets:read` and/or `availability:read` for assigned, published event reads. Existing keys retain their permissions.

See [the Phase 3 guide](docs/integrations-phase3.md), [checkout OpenAPI](docs/integrations-phase3-openapi.json) and [progress checklist](docs/integrations-progress.md). Apply `202610140002_integration_hosted_checkout.sql` before deploying the shared checkout/payment adapters. Explicit `checkout:write` and `orders:read` permissions support idempotent hosted checkout and minimal application-scoped status. Hosted purchases reuse ordinary/free/group reservation, Paystack, issuance, history and delivery. They remain disabled until server signing/configuration is set. Test business operations require a separate deployment/project and matching Paystack test key; production dashboard Test keys are not replicated to that project. Isolated local Paystack test purchase checks passed separately; the public online deployment/return acceptance remains pending and email testing is deferred. Phase 5 adds the separately enabled widget below.

### Developer integrations — Phase 4

Outgoing signed notifications now use a transactional PostgreSQL outbox and durable leased retries. Organisers can configure, pause, rotate or retire webhook endpoints and view paginated delivery history in Developers & Integrations. See [the Phase 4 guide](docs/integrations-phase4.md), [webhook OpenAPI](docs/integrations-phase4-openapi.json) and [progress](docs/integrations-progress.md). The additive `202610160001_integration_webhooks.sql` migration must be rehearsed in the separate sandbox before deployment. No remote migration or deployment was performed for this phase.

Configure dedicated server-only encryption keys and `CRON_SECRET`; outgoing dispatch remains disabled until `INTEGRATIONS_WEBHOOKS_ENABLED=true`. The initial Vercel Hobby schedule is daily, bounded to at most 20 deliveries per invocation, and is unsuitable for real-time/high-volume notifications. Production activation, a durable public receiver and an observed scheduled delivery are still required. The separate Partner Demo receiver remains disabled until it is configured with durable storage and this contract.

### Developer integrations — Phase 5

Organisers can opt an application into **Embed ticket selection**, choose an assigned published event and copy a public widget snippet. The isolated iframe shows ticket choices, then opens the existing hosted checkout at the top level. Group selections count admissions using the current engine. API secrets stay on partner servers; the public widget ID grants no private API access.

See [the Phase 5 setup/deployment guide](docs/integrations-phase5.md), [widget OpenAPI](docs/integrations-phase5-openapi.json), [external example](examples/widget/index.html) and [progress](docs/integrations-progress.md). Rehearse `202610160002_integration_widgets.sql` after the Phase 1–4 migrations in the separate sandbox. Widgets default disabled until server-only `INTEGRATIONS_WIDGETS_ENABLED=true` and per-application/mode permission are configured. Hosted checkout additionally needs its existing signing/resource settings. Exact registered website origins and event grants are required. No remote migration, public deployment or environment change was made in Phase 5; public widget purchase/return and earlier operational gates remain pending. Phase 6 was subsequently authorised; see below.

### Developer integrations — Phase 6

Advanced operations add application-attributed orders, purchased-ticket status, separately permitted attendee names/contact, sales summaries and read-only group/refund status. Optional delegated verification/check-in uses the key creator's current organiser authority and the existing one-admission engine. Other applications and marketplace purchases remain outside this boundary; no QR/receipt/invitation capability or partner refund/group-claim write API is exposed.

See [the Phase 6 guide](docs/integrations-phase6.md), [advanced OpenAPI](docs/integrations-phase6-openapi.json) and [progress report](docs/integrations-progress.md). Rehearse `202610160003_integration_operations.sql` in the isolated sandbox after earlier migrations. It adds a private bounded entry-idempotency table, scoped adapters and a targeted group/privacy-erasure compatibility fix. `INTEGRATIONS_ADVANCED_ENABLED` and the additional `INTEGRATIONS_ENTRY_ENABLED` default to false; explicit key scopes are also required, and existing keys gain none automatically. No remote migration, deployment or real environment setting was changed. Public purchase/widget/webhook acceptance remains pending at the user's request. Phase 7 is implemented locally; see below for rollout gates.

### Developer integrations — Phase 7

The footer now links to `/developers`: setup, server authentication, hosted checkout, widget, webhook, sandbox, security and FAQ guides, an expandable reference and a combined public `/api/v1/openapi.json`. The private admin workspace adds integration activity/usage/audit and password-confirmed suspension. Admin authentication gains bounded shared login limits, compatible scrypt hash upgrades and credential-bound cookies. The additive `202610160004_integration_readiness.sql` must precede this authentication code's deployment; existing cookies require signing in once.

See [Phase 7 results](docs/integrations-phase7.md), [rollout/recovery](docs/integrations-rollout.md) and [progress](docs/integrations-progress.md). `npm run integrations:readiness` checks structural settings and origin-bound acceptance evidence without printing secrets or contacting services; exit 1 is expected until activation and public gates pass. Source verification does not complete sandbox deployment, a real online test purchase, durable receiver/cron or physical-device acceptance. No production rollout was performed.

### Public sandbox acceptance — 16 October 2026

The separate [sandbox](https://naija-tickets-sandbox.vercel.app), [Partner Demo](https://naija-tickets-partner-demo.vercel.app) and [widget preview](https://naija-tickets-partner-demo.vercel.app/widget.html) are deployed. Actual Paystack TEST purchases/return, group/QR/entry/free-history and durable manual notification checks passed. Read the current [progress report](docs/integrations-progress.md) for evidence and remaining automatic cron/physical/Safari/cookie/refund/recovery gates; email is deferred. Main production is unchanged. Before a later main rollout, include shared widget-limiter migration 202610160006 and the default-export Web middleware fix. The sandbox-only Partner Demo inbox migration 202610160005 must not be copied into main. Keep the single cron declaration in vercel.json; duplicating it in Nitro output breaks deployment.
