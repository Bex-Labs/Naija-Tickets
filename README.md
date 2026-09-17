# Naija Tickets

An interactive Nigerian event discovery and ticketing platform. The current build includes a polished public homepage, searchable event catalogue, shareable filters, pagination, event details, ticket tier selection, sold out handling, branded account flows, organiser and administrator workspaces, immediate post-payment ticket passes, and a production-ready database foundation.

## Local setup

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Public event pages, search, city counts, checkout, and both workspaces use the configured Supabase project as their event source.

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

The browser never sends an amount to Paystack. The initialization endpoint loads the guest or signed-in customer order and total from Supabase. Both the callback and webhook use the same atomic database function, so retries cannot issue tickets twice. A successful payment received after a reservation expires is recorded for support review without consuming inventory or issuing tickets.

After a successful callback, `/payment/status` uses the random 36-character order reference as a private bearer capability. The server validates that reference, confirms the persisted order is paid, and only then reads issued ticket codes. Each ticket is rendered from stored order, event, attendee and ticket-tier data with a scannable QR code. Pending, failed, expired and invalid orders never expose ticket codes. Customers can print the passes or save them as a PDF through the browser.

### Ticket email setup

1. Verify the sending domain in Resend and finish the SPF and DKIM records shown in its dashboard.
2. Create a sending-access API key, then add `RESEND_API_KEY` and an `EMAIL_FROM` address on the verified domain to `.env.local`.
3. Set `APP_URL` to the exact public HTTPS origin, with no path, so emailed ticket links return to the correct Naija Tickets installation. Local development may use `http://localhost:3000`.
4. Add those same values to production hosting only when the domain is ready. Keep `RESEND_API_KEY` server-only.
5. The paid callback, signed webhook and free-checkout finaliser share one database delivery claim and use a stable Resend idempotency key. A failed delivery remains retryable, while a sent order is not deliberately sent twice.

Email delivery runs as background work and is not required for the post-payment ticket page. The email includes the real event date, local time, timezone, venue, ticket tier, attendee and entry code, plus the private link to the server-verified QR ticket page. Verified tickets remain immediately available when Resend is missing or temporarily unavailable.

The branded confirmation and recovery templates are stored in `supabase/templates`. The hosted authentication service requires custom SMTP or a qualifying paid configuration before those templates and a Naija Tickets sender address can be activated. Use a dedicated authentication sender such as `no-reply@auth.yourdomain.com` with SPF, DKIM and DMARC configured.

### Platform service fee

An authenticated administrator can open **Settings → Service fee** and choose either a percentage of the ticket subtotal or a fixed NGN amount per ticket. Percentage values are stored as integer basis points; fixed values are stored as integer kobo per ticket. The form shows a worked preview and requires the administrator's current password before saving.

The reservation transaction reads the active rule directly from `platform_settings`. It ignores fee values from the browser, applies percentage fees to the subtotal, multiplies fixed fees by ticket quantity, stores the final fee and total on the order, and defaults safely to 5% when the setting is absent or invalid. Paystack then charges that stored total. Every fee change is recorded in `audit_logs`.

### Organiser settlement

Paystack currently settles the complete checkout charge into the platform owner's Paystack account. The order stores the organiser's ticket subtotal and the separately calculated platform service fee. Under the current buyer-fee model, the service fee is platform revenue; the organiser's starting balance is the paid ticket subtotal. Approved refunds, chargebacks and any disclosed settlement deductions reduce the amount due before the administrator records a payout.

The existing `payouts` table stores a settlement period, gross ticket sales, fees, refunds, net amount and payout status. Automatic bank-recipient creation and Paystack Transfers are intentionally not enabled yet, so the administrator must reconcile the sales period, pay the organiser outside the app and mark the payout record paid. Before launch, add verified organiser bank details, transfer-recipient provisioning, approval controls, Paystack transfer webhooks and a complete payout audit trail if in-app automated settlement is required.

### Guest purchase privacy

The administrator's **Guest buyers** section lists guest purchases with their contact details, event, reference, status, amount, date and ticket count. Search is available across those fields. Personal-data removal requires the current administrator password and an explicit `ERASE` confirmation.

The database operation anonymises purchaser and attendee data in the order, order items, tickets, payment provider payloads and email delivery record in one transaction. It keeps order totals, payment reconciliation, ticket validity, private ticket codes and the audit trail. It never hard-deletes the purchase, and the customer and organiser workspaces cannot call the operation.



## Useful commands

```bash
npm run dev
npm run build
npm run lint
npm test
```


