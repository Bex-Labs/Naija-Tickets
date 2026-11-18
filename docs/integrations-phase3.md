# Phase 3 — hosted checkout

Implemented 14 October 2026. Local automated verification is recorded in [the progress report](integrations-progress.md). The real external-site → Paystack test payment acceptance check is pending: the separate sandbox project and test key are not set up yet. Phase 4 has not started.

The current machine contract is [Phase 3 OpenAPI](integrations-phase3-openapi.json), including the earlier event APIs. Deploy the source and migration together before enabling checkout. No production deployment or signing-secret configuration is included in this change.

## What happens

1. A partner **server** sends selected ticket IDs and package quantities to `POST /api/v1/checkout-sessions`. Use a key with `checkout:write` and a unique `Idempotency-Key` for that purchase intent.
2. Naija Tickets stores the selection and returns a private hosted checkout URL. This does **not** hold inventory or create an order yet.
3. Redirect the buyer to that URL in the top-level browser. The existing checkout collects their details and ordinary attendee details. Group purchases collect only the buyer's details.
4. Submitting the form reserves inventory through the existing `create_checkout_reservation_v3`. A session can create one order. Repeating the same form request returns that order; changed buyer/account/attendee details conflict rather than creating another order.
5. Existing free booking or Paystack checkout uses the stored total, promo, fee and organiser split settings. Callback verification or the signed incoming Paystack webhook finalises the existing order and issues its tickets once.
6. Existing email delivery runs after verified payment. Signed-in buyers retain the purchase in their account; guests retain existing emailed/receipt access. Email failure does not reverse payment or invalidate tickets. Delivery still uses the existing background mechanism; durable outgoing partner webhooks belong to Phase 4.
7. The buyer returns to a currently registered partner origin, with `nt_session` and `nt_status` only. The partner server calls `GET /api/v1/checkout-sessions/{sessionId}` with `orders:read` to confirm the authoritative result.

Group packages use the current system: two group-of-five packages reserve/sell ten admissions, create ten unclaimed slots without usable QR codes, and reuse existing group registration and buyer ticket pages. This phase adds no partner attendee, claim or entry API.

## Permissions and request example

Generate a newly scoped key in **Organiser → Developers & Integrations**, assign the event and register return website origins. Existing keys are not upgraded. Rotation preserves permissions. `checkout:write` creates sessions; independent `orders:read` reads only this application's sessions. Event reads retain their own scopes.

Call from your server, keeping the credential in its environment:

```js
const response = await fetch(`${process.env.NT_API_BASE}/api/v1/checkout-sessions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.NT_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'purchase-intent-2026-001',
  },
  body: JSON.stringify({
    event_id: 'YOUR_ASSIGNED_EVENT_UUID',
    items: [{ ticket_type_id: 'YOUR_TICKET_TYPE_UUID', quantity: 2 }],
    return_url: 'https://partner.example/complete',
    cancel_url: 'https://partner.example/cancel',
  }),
});
const result = await response.json();
// On HTTP 200, redirect only this buyer to result.data.checkout_url.
// Redact the URL and raw key from logs/analytics; the URL is a private capability.
```

Only documented fields are accepted. Never send price, amount, customer ID, purchaser or attendee details through this API. `promo_code` is optional; a supplied code is locked on the hosted form and validated when reserving. Without a supplied code, the buyer can enter one. Returns require an exact registered origin plus a simple path; HTTPS only except test localhost HTTP. No query, fragment, credentials, wildcards, percent escapes or backslashes. `cancel_url` defaults to `return_url`.

POST and GET both use the existing `data`/`meta.request_id` success envelope and structured `error.code/message/request_id` failures. Creation/replay returns HTTP 200. Wrong payload with the same idempotency key returns 409 `IDEMPOTENCY_CONFLICT`; unavailable selection/reservation conflicts return 409. No query parameters. Creation body limit is 16 KiB, at most 20 ticket types and 20 packages per type, bounded by each tier's rules and 400 admissions total. Browser secret-key calls are denied; there is no browser CORS permission for this API.

Same idempotency key + same normalised intent returns the original session and URL, including after response loss. Keep old signing versions available for their session lifetime when rotating. Expired/cancelled sessions cannot be revived using that key; use a new intent/key for a new checkout. Issuing-key rotation/revocation, application disable, manager permission loss or event-grant removal blocks new unpaid actions. Already authorised provider payments still finalise safely so paid buyers do not lose tickets.

## Status and expiry

Status includes session/event/mode, dates, admissions, integer NGN kobo subtotal/discount/fee/total and aggregate issued/registered counts. Amounts are `null` before reservation. It excludes purchaser/attendee information, private order references, QR codes, receipt links and checkout capabilities. `tickets_issued` counts claimed/checked-in admissions; unclaimed group slots are sold but not usable tickets yet.

States: `open`, `reserved`, `pending`, `paid`, `failed`, `expired`, `cancelled`, `refunded`, `partially_refunded`. The session lasts up to 30 minutes and cannot exceed issuing-key expiry. The existing reservation lasts up to ten minutes and cannot outlive the session. Hosted pages recover the same hold/token after refresh or sign-in. The initial URL exchanges its capability for an HttpOnly, SameSite cookie and removes it from the address before login; hosted pages are private, non-indexable and cannot be framed.

The partner must ignore an unverified browser `nt_status` when deciding whether payment succeeded. Read the server API. A failed or uncertain provider initialisation does not silently create a second reference: an expiring database lease serialises starts and retries retain the attempt. A definitively failed/abandoned hosted attempt requires a new checkout intent. Cancellation releases unpaid inventory; it is not a refund. A late successful payment after the hold expires is retained for support reconciliation and issues no tickets, matching the existing policy.

## Database and configuration

Migration: `202610140002_integration_hosted_checkout.sql`. It adds private session/resource-binding tables, nullable order attribution and payment-initialisation lease columns, scopes and request labels. Private wrappers preserve the existing reservation/payment/issuance signatures and response shapes. A common event inventory lock serialises mutations; expired-hold cleanup now handles only the selected event, avoiding cross-event locking. Event-level sale windows and event end/status now also protect ordinary checkout. Current fee, promo, QR, refund and payout engines remain authoritative. Default database resource mode is `live`.

Use these **server-only** settings; never prefix them with `NEXT_PUBLIC_`:

| Setting | Purpose |
| --- | --- |
| `INTEGRATIONS_CHECKOUT_ENABLED=true` | Explicitly enables hosted creation/payment. Absent defaults to disabled. |
| `INTEGRATIONS_RESOURCE_MODE=live` or `test` | Deployment business-data mode; absent defaults to live. |
| `INTEGRATIONS_SIGNING_SECRET` | Dedicated randomly generated secret, at least 43 characters. Do not reuse admin, service-role or Paystack secrets. |
| `INTEGRATIONS_SIGNING_KEY_VERSION=v1` | Version for new capabilities. |
| `INTEGRATIONS_PREVIOUS_SIGNING_KEYS` | Optional JSON object of at most two prior version/secret pairs, retained only until prior sessions expire. |
| `INTEGRATIONS_SANDBOX_PROJECT_REF` | Separate 20-character sandbox Supabase project reference, required in test mode. |
| `INTEGRATIONS_LIVE_PROJECT_REF` | Different 20-character live project reference, required in test mode. |

Existing `APP_URL`, Supabase and Paystack settings still apply. `APP_URL` must be the trusted deployment origin. Paid hosted live sessions require `sk_live_`; test sessions require `sk_test_`. Wrong/missing signing or environment configuration fails closed with 503. Configuration/introspection does not certify provider connectivity. Do not alter production variables or enable live checkout until the sandbox acceptance check passes and production configuration is approved.

Signing rotation: set the former version/secret in `INTEGRATIONS_PREVIOUS_SIGNING_KEYS`, install a new secret and version, redeploy, then remove the old entry after its last 30-minute session expires. Keep sandbox and live signing material separate. Lost/removed signing versions cannot reconstruct old checkout URLs. Raw capabilities and API credentials are never stored in sessions; only digests and versioned metadata are stored.

## Set up the isolated sandbox

1. Create a separate Supabase test project and separate test deployment using the same source. Apply the repository migrations there. Use only fictitious organisers, customers, events and tickets; never copy production customer data.
2. Configure that deployment's Supabase URL/public key/service-role key from the **test** project. Set `APP_URL` to the test deployment's reachable origin, use the Paystack **test** secret, and configure the settings above with distinct actual project references and separate signing material. Avoid configuring customer email delivery until controlled test recipients are ready.
3. In the **test project's SQL editor only**, record its matching resource binding:

   ```sql
   update public.integration_resource_settings
   set environment = 'test',
       project_ref = 'SANDBOX_PROJECT_REF',
       live_project_ref = 'LIVE_PROJECT_REF'
   where singleton;
   ```

   Replace the placeholders with the two real references; the constraint rejects missing/equal/malformed references. The server also checks that its source URL points to the sandbox reference and its stored binding matches its configuration. Never run this update on the live project.
4. Register a fixture organiser/application and its events in the **sandbox dashboard**. Generate a **Test** key there with `checkout:write` and `orders:read`, plus any read scopes needed. Register the sample partner's exact origin. The production dashboard's Test keys do not authenticate against a separate database; there is intentionally no credential/customer replication or automatic cross-project mapping.
5. Run a separate partner server and redirect its test buyer using the example above. For localhost testing, a simple partner at `http://localhost:3001` may use `/complete` and `/cancel` as return paths. The API call comes from that server, not the browser.
6. Complete ordinary paid, free and group test bookings using Paystack's official test-payment instructions. Confirm server session status, customer history, organiser admissions/sales, group unclaimed slots, claim QR creation and controlled email delivery. Repeat callback/status visits and confirm no duplicate records. Cancel another booking; verify its hold releases. Revoke a key/remove a grant and confirm new unpaid actions fail.
7. Confirm Test keys fail against the live deployment and Live keys fail against the sandbox. Test amounts/tickets/reports must remain exclusively in the sandbox. Record the actual browser/provider results before marking Phase 3 accepted.

The current workspace has **no separate configured sandbox**, so step 6 has not run. Automated fixtures prove code/SQL behaviour, not a real Paystack purchase or mailbox receipt. No production secret, paid service, real charge or deployment was introduced.

## Local verification

Run `npm test`, `npx tsc --noEmit --incremental false`, `npm run lint`, and `VERCEL=1 NITRO_PRESET=vercel npm run build`.

`npm run test:integrations:concurrency` is an explicit destructive **disposable test database** harness, separate from the normal suite. It creates fixture schemas/roles and uses independent `psql` connections. It does not take production connection URLs. Use either a fresh `naija-phase3-*` PostgreSQL Docker container with database `naija_phase3` (`NAIJA_TEST_POSTGRES_CONTAINER`), or a newly initialised local PostgreSQL cluster with Unix socket `/tmp/naija-phase3-pgXXXXXX`, no TCP listener, database `naija_phase3`, user `postgres`, and `NAIJA_TEST_POSTGRES_BIN`, `NAIJA_TEST_POSTGRES_SOCKET`, `NAIJA_TEST_POSTGRES_PORT`. Stop and remove only that disposable cluster afterward. The harness checks absent-row idempotency, final inventory, early-bird and promo limits, payment leases, duplicate group finalisation and cancel/reserve races. It is a bounded concurrency check, not a production load certification.
