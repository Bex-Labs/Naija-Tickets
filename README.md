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
