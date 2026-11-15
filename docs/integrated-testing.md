# Test and Live integrations in one app

Use the existing Naija Tickets app, organiser account and Supabase project. A second sandbox project, deployment or Partner Demo is not required. Older standalone sandboxes can remain unchanged but are optional.

## Organiser: test from VS Code

1. Run your website using VS Code Live Server (or its normal dev command). Open its browser URL; do not open the HTML as `file://`.
2. In Naija Tickets → Developers & Integrations, create/select a website connection.
3. Choose **On my computer** and **Test a purchase**.
4. Enter the base address, e.g. `http://127.0.0.1:5500`. Leave out `/dist/index.html` here.
5. Select the published event to rehearse and save website settings. This authorises that event only; it does not publish drafts.
6. Under **Create a Buy Tickets link**, choose the event. Set **Return to your website** to the full page, e.g. `http://127.0.0.1:5500/dist/index.html`.
7. Create the Test checkout link and copy it into your website's Buy Tickets button. No API key is needed for this option.
8. Click your button. Choose tickets and complete a Paystack Test payment using Paystack's displayed test options. No real money is charged.
9. Confirm the checkout shows a verified purchase and [TEST] tickets, then returns to your page. A return URL parameter alone is not proof of payment.

For a hosted rehearsal, choose **On the internet** + **Test a purchase**, save your HTTPS website address, and follow the same steps. Localhost and 127.0.0.1 are different addresses; use the one actually shown by your browser, including the port.

## Developer API

Use the same Naija Tickets API base in Test and Live. Generate a Test key in the saved Test connection with only the permissions needed (`integration:read`, `events:read`, `tickets:read`, `availability:read`, `checkout:write`, `orders:read` for a typical purchase).

Your API/no-code choice is saved with the connection and restored after refresh. A key in a frontend `.env` alone does not wire a Buy Tickets button: it must call a running backend route. The included `examples/hosted-checkout` Node starter loads `.env.local` and displays its working button using `node node.mjs`; its event ID and local cookie secret are optional.

Store the key only in the partner's server environment. The partner backend reads authorised events/tickets, creates a checkout session with an Idempotency-Key, and sends only the returned public checkout URL to its frontend. That URL opens the existing secure checkout/popup. Verify the session status from your backend after return; never trust `nt_status`, JavaScript messages or a screenshot as proof of payment. The existing developer guide and downloadable examples describe the endpoint bodies.

Test API reads return the hidden test event/ticket IDs. Use those IDs for subsequent test requests. Externally managed events created with a Test key are also hidden Test records. Pricing, group admission counts and availability are checked by the existing database engine.

## Go live

1. Publish the partner website on HTTPS.
2. In the same organiser dashboard, choose **On the internet** + **Accept real purchases**. Save its HTTPS base address and event permissions.
3. Create a Live checkout link, or issue a Live API key for the partner backend. Replace the Test link/key and use Live event/ticket IDs.
4. Configure the production app's public APP_URL and privately configure PAYSTACK_SECRET_KEY with a valid `sk_live_` secret. Set HOSTED_CHECKOUT_PAYMENT_MODE=live (or leave it unset). Keep PAYSTACK_TEST_SECRET_KEY as `sk_test_` if testing should remain available.
5. The button stays blocked with a specific explanation until Live checkout is configured. Test orders cannot use Live credentials.
6. Run a controlled real purchase and verify the order, QR, return, confirmation and settlement before inviting customers.

## Platform setup (one time)

- Preserve the existing main database and private `.env.local`.
- Ensure the existing external-event migration `202610290001_external_embed_events.sql` is installed (hidden event support). Apply `202611120001_integrated_testing.sql` if missing, then `202611130001_single_project_testing.sql` **to the main database only**. Never reset a database to install these changes.
- Keep the existing hosted checkout flags and dedicated signing secret:

```dotenv
INTEGRATIONS_CHECKOUT_ENABLED=true
INTEGRATIONS_HOSTED_LINKS_ENABLED=true
INTEGRATIONS_LOCAL_TESTING_ENABLED=true
APP_URL=http://localhost:3000
# Private Paystack Test secret. Never put a value in frontend code.
PAYSTACK_TEST_SECRET_KEY=
```

For local development, `npm run integrations:enable-testing` checks the database migration and reuses an existing `sk_test_` main key when present. It writes only ignored `.env.development.local`; it does not replace `.env.local`, change the main payment preference or publish anything. Restart `npm run dev` afterward. In Vercel, configure these variables directly (APP_URL must be public HTTPS) and redeploy. No additional Supabase URL or service-role key is needed.

## Boundaries

- Assigned real events are copied on demand into a hidden Test tenant in the **same database**. Original quantities are never modified by test orders. Existing sold/reserved Test counts survive catalogue refreshes.
- Database-derived `is_test` markers distinguish Test organisers, events and orders. Hidden Test events cannot be featured or publicly browsed. Admin event/guest/transaction lists and sales metrics exclude them; their activity appears in the connection's **Test purchase activity** report.
- API authentication and permissions remain checked against the original connection. Disabling/removing a connection, revoking keys or removing event grants blocks new/unpaid Test checkout, including already-open sessions.
- Server-selected payment mode is pinned before provider initialization. Callback verification uses that mode; webhook signatures and provider domain must match. Test payments never use a real organiser's settlement split.
- Tickets retain [TEST] event names when viewed, saved or printed. Codes are scoped to their Test event; they cannot admit people to the original live event. Group claims and one-time check-in reuse the existing engines.
- Optional signed webhooks need a public HTTPS receiver and configured dispatcher. Local checkout testing uses the verified session-status API and does not need webhooks. The old widget is optional; the simplest no-code path is the checkout link.
- No existing records are converted to Test by this migration. Historical main-site Paystack Test purchases are left unchanged.

## Verification record

Automated PostgreSQL fixtures exercise both no-code and API checkout in one database, free ticket issuance, paid-provider finalization (simulated verified payload), 2 × Group-of-5 = 10 unclaimed admissions, claim + unique QR, rejection at the real event, duplicate check-in, provider-mode mismatch rejection, source revocation, original stock preservation and exclusion from real admin sales/transactions. Actual provider/browser and deployment acceptance must be recorded separately; an automated fixture does not prove a real Paystack payment occurred.


13 November local activation results: main migrations installed, local configuration enabled, 396 automated tests passed, TypeScript/lint/build passed and 77 public build files passed the credential scan. Actual local API authentication, catalogue reads, session creation, reservation, Paystack Test initialization and local cancellation/return passed. The browser displayed the actual [TEST] Book Club checkout. Temporary keys were revoked and test reservations cancelled. No provider payment was completed, email sent or Vercel deployment made.
