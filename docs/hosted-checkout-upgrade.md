# Hosted checkout upgrade — engineering report

Date: 17 October 2026 (Africa/Lagos). This implements the replacement hosted-checkout brief. The earlier experimental popup is removed; checkout is a dedicated top-level Naija Tickets page. Existing catalogue, key management, widgets, webhooks, operational APIs and direct checkout remain supported.

## Audit and implementation

The repository uses Vinext/Vite/Nitro, React 19, Supabase and Paystack. The previous integration phases already provided API key hashing/scopes, Test/Live bindings, exact website-origin registration, short-lived HMAC-derived hosted capabilities, transactional reservation/idempotency, server verification, QR issuance, group claims and a durable outgoing webhook outbox. Those implementations were inspected and reused. No second payment, order, ticket, identity or inventory system was introduced.

| Feature | Implementation | Verification |
| --- | --- | --- |
| Standalone hosted checkout | Event artwork, organiser, date/venue/short description; live ticket categories, quantity limits/sold-out states; buyer/attendee form and summary; guest checkout; existing Paystack methods; no marketplace navigation | Verified by types/lint/build, database tests and actual public browser checkout |
| Hosted Checkout API | Existing canonical `POST /api/v1/checkout-sessions`; event required, items optional; bounded customer prefill and external reference; old request/URL format retained | Verified by scope/tenant/idempotency/mode tests and Partner Demo’s real API-created purchase |
| No-code checkout links | Assigned event + Test/Live + approved return URL; reusable public link and HTML button; enable/update/disable | Verified by manager/domain/event/RLS tests, public link creation, free purchase and live disable/re-enable checks |
| Return and confirmation | Verified payment returns to focused hosted confirmation with existing tickets/group invitations, then optional registered organiser return; cancellation releases only unpaid reservations | Verified by a marked Paystack Test purchase, hosted confirmation, group claim/QR/entry and Partner Demo return |
| Attribution/reporting | Direct, hosted API, hosted link and legacy-widget channels; 30-day verified purchases, admissions, discounted ticket revenue, fees, confirmed refunds, checkout funnel/conversion and recent 50 session/order IDs | Verified by tenant/PII tests and authenticated organiser HTTP reports; private admin source/types/lint/build checked |
| Fulfilment and commissions | Existing Paystack initialise/finalise, unique admission/QR generation, group claims, organiser sales and payout/fee calculations retained | Existing regression suite; email delivery configuration/receipt delivery is deferred on the sandbox |
| Examples/documentation | Developer portal, OpenAPI, runnable Node partner, Next.js route wrapper and HTML link | Mocked server lifecycle tests and syntax/build checks; standalone physical-device example acceptance pending |

**Fully implemented:** hosted page, no-code links, existing API extension, safe return/cancellation and capability-checked expired-session recovery, organiser controls and source reports, admin report integration, reservation/Paystack/ticket/group reuse and documentation/examples.

**Partially verified:** the existing email hook is retained but actual delivery is deferred; admin report UI compiles but was not manually exercised in an authenticated browser, and the Next.js adapter was not deployed as a separate application. Responsive browser testing does not replace physical-device/Safari acceptance.

**Not performed:** main production migration/deployment, Live payment activation, email-domain setup, independent load/security certification and the outstanding provider/scheduler recovery acceptance. These are configuration/operational gates, not promised working features.

“Implemented” is a source/functionality statement, not production certification. No real-money charge or main production deployment is performed by this upgrade. The final test/public acceptance evidence belongs in `docs/integrations-progress.md`.

## API contract

Use the existing endpoint, not a newly invented alias:

```http
POST /api/v1/checkout-sessions
Authorization: Bearer YOUR_SERVER_ONLY_KEY
Idempotency-Key: your-stable-purchase-intent
Content-Type: application/json
```

```json
{
  "event_id": "YOUR_ASSIGNED_EVENT_UUID",
  "return_url": "https://partner.example/tickets/complete",
  "cancel_url": "https://partner.example/events",
  "external_reference": "TGIF-ORDER-123"
}
```

Optional `items` is an array of `{ "ticket_type_id": "UUID", "quantity": 2 }`. Omit it or use `[]` to let the customer choose on Naija Tickets. Optional `customer` contains only `email`, `name` and/or `phone` for editable prefill; it cannot select an authenticated account. Optional `promo_code` retains existing rules. Prices, fees, organiser IDs, customer IDs, QR records and inventory figures are rejected as input.

The existing response envelope is `{data, meta}`. `data` contains the session `id`, status, expiry, event, environment, admissions/amounts and private `checkout_url`; status responses additionally identify `source` and the caller’s nullable `external_reference`. Unreserved amounts may be null. Redirect only that buyer to the returned URL. Do not log, cache or publish it. The query capability is transferred into a path-scoped HttpOnly SameSite=Lax cookie and stripped. Sessions last at most 30 minutes; inventory holds last at most 10 minutes and cannot outlive the session.

`GET /api/v1/checkout-sessions/{sessionId}` requires `orders:read` and is application/tenant/environment scoped. Return query parameters (`nt_session`, `nt_status`) are UI hints only. Partners must verify browser/account ownership and query status on their server. Only verified paid state can fulfil. Signed webhooks provide asynchronous updates even if the buyer never returns; validate signature/timestamp and persist deduplication before acknowledging.

The existing key dashboard shows secrets once, stores only hashes and supports narrow scopes, expiry, rotation and revocation. Test resources require an isolated database and test provider credentials. Test key prefixes alone are insufficient isolation.

## Browser and management routes

- `/integrations/checkout/{sessionId}`: private standalone checkout/confirmation.
- `/checkout/link/{publicId}`: reusable public event link; creates a private session using a same-origin bounded POST.
- `POST /api/integrations/links/{publicId}/start`: browser link handoff; no API credential accepted, exact platform origin and shared global/IP/application/organiser budgets enforced.
- `POST /api/integrations/checkout/{sessionId}/selection`: capability-protected same-origin selection update, only before reservation; current actor/event/quantity/availability checks are enforced transactionally.
- Existing `/reserve`, `/pay`, `/cancel` browser actions remain in use.
- `GET/POST /api/organiser/integrations/{id}/hosted-links`: confirmed organiser login, current explicit integration-manager permission, configured environment and assigned owned event required. Lists links/report or saves a link.
- Existing private admin integration inspection additionally shows the same bounded sales/report projection after administrator authentication. It does not expose customer contacts, QR codes, credentials or private receipt links.

None of these browser or organiser management endpoints is a secret-key bypass. The machine API rejects browser-origin calls as before. All new tables/helpers use RLS with no anon/authenticated direct database grants.

## Organiser instructions

1. Create/publish the event with its normal ticket types. Groups keep their existing admission counts and attendee-claim flow.
2. Open **Developers & Integrations** and create/select an application. Register the exact Test or Live website origin and assign the event.
3. Under **Hosted Checkout**, select the event/environment and an approved return address. **Create checkout link**; copy its URL or HTML Buy Tickets button. This method needs no API key. The normal link URL can be published.
4. For a developer integration, issue a key with `checkout:write`, `orders:read` and only the other required scopes. Store it on the partner server. Create the session using the real event UUID and redirect the buyer. Keep stable idempotency per purchase attempt.
5. View sales channels, the checkout conversion funnel and recent session/order IDs under Hosted Checkout. All values use existing orders/payments; they do not constitute a second balance or payout ledger.
6. Existing embedded ticket-selection widgets are clearly labelled legacy; they remain compatible and still hand off to hosted checkout. No iframe checkout is the default.

## Migration and configuration

Required additive migrations: `supabase/migrations/202610170001_hosted_checkout_links.sql` and `supabase/migrations/202610170002_hosted_report_efficiency.sql`. It adds link settings, optional private prefill/reference and a link actor to existing sessions; permits initially empty selections; extends private actor/selection/report helpers and source/status projection. It also fixes the fully refunded session projection when the existing payment is marked refunded. Existing data is preserved. No table or customer record is removed, and no database reset is used. Existing actor/intent check constraints are replaced only to permit the new bounded alternatives.

The migration depends on earlier integration phases through Phase 7 and shared widget-limiter migration `202610160006`. The sandbox also has its private inbox migration; never copy that inbox to production. Before any rollout, verify the linked project reference, review pending migrations, run a dry-run, and apply the reviewed additive set. The main remote database still needs its previously pending Phase 4–7 migrations plus this upgrade before this source can be deployed there.

The second migration indexes 30-day reporting, aggregates payment states before expanding only fifty recent ticket snapshots, and exposes actual remaining package inventory separately from order limits. Private customer prefill is cleared once the session has an order; bounded expired-prefill cleanup runs during new API creation and the existing authenticated daily dispatcher. These jobs do not delete orders, tickets, profiles or financial records.

No hosting change is necessary. Use existing `APP_URL`, Supabase publishable/service-role variables, matching Paystack secret and dedicated checkout signing configuration. Enable `INTEGRATIONS_CHECKOUT_ENABLED=true` and new `INTEGRATIONS_HOSTED_LINKS_ENABLED=true` only after migration/binding acceptance. Both Test/Live key scopes and current per-application/event/domain permissions still apply. The old experimental `INTEGRATIONS_POPUP_ENABLED` is unused and can be removed.

Production Paystack requires a matching live key and an incoming provider webhook pointing at the existing platform webhook route. Partner webhook URLs must be configured and registered separately; Hobby’s daily outgoing dispatcher is not a realtime delivery guarantee. Email requires the platform’s existing verified sender/Resend configuration. Email setup is explicitly deferred for this sandbox; fulfilment remains visible on the hosted confirmation.

## Abuja TGIF test checklist

Use only an isolated Test project and fictional attendees. Create **Abuja TGIF — Sandbox**, with General Admission, an optional free category and a Squad Pass admitting five people. Assign it to a Test integration and register a test partner origin. Instructions/examples are in `examples/hosted-checkout/README.md`.

Verify no-code creation/copy/open and API creation with optional/preselected items. Reject invalid keys, missing checkout:write, foreign events, unregistered return addresses, fake prices and mode mismatch. Test ordinary + group purchase: one ordinary plus one Squad Pass must reserve/issue six admissions, with no usable QR for unclaimed group slots. Repeat payment callbacks to confirm no extra tickets. Test failed/pending payment, cancelled/expired checkout, return ownership, refund invalidation, disabled links, live availability, mobile layout and the unchanged direct checkout. Inspect organiser/admin channel totals and check only verified existing orders contribute. Complete the usual QR claim/one-time entry checks using the existing entry system.

Outstanding production acceptance is not waived: independent concurrency/load and broader security review, physical phone/Safari/payment authentication, actual scheduled webhook delivery and provider refund/recovery should remain recorded separately from unit/database/browser tests.


## Verification results

- Main source: **339/339** regression tests passed; focused hosted database suite **12/12** passed. TypeScript, lint, Vercel build and whitespace checks passed.
- Separate sandbox: **340/340** tests passed, including its private inbox fixture; types/lint and Vercel deployment passed. The two new migrations were dry-run and applied only to test project `bergfstacaeqqhdjvyyf`.
- Partner Demo: **32/32** tests and build/secret scan passed. A terminal-state retry fix prevents reopening an old paid/cancelled/expired purchase intent; its public confirmation was verified in the browser after the fix.
- **9 real public purchase/QR checks:** verified Paystack **Test** payment of NGN 47,250; five paid group places; one claim and four unclaimed places; duplicate callback without extra issuance; duplicate contact claim rejected; actual browser SVG QR decoded; customer denied entry, organiser admits once, repeat rejected; a free no-code guest purchase issues one ticket; authenticated reports and server-key status reconcile.
- **10 public boundary/contract checks:** invalid key, cross-origin starts/selection, unauthenticated management, framing/caching, removed popup SDK, private files and the twenty-path implemented machine contract.
- **6 additional public lifecycle checks:** foreign account report denied, malicious return denied, no-code link disable/unpaid-session blocking, re-enable/cancel/approved return, rejected/expired payment has no tickets, optimised reports and protected prefill/cron controls. The public demo link was left enabled.
- **2 expired-checkout recovery checks:** an expired session with its matching capability shows only an approved organiser return; a wrong capability receives no destination or payment authority. Active-but-ended holds also hide payment actions.
- **80 public assets** across the final sandbox browser build and Partner Demo contain none of their configured server secrets or complete integration credentials.
- A 425px browser view completed checkout; a wider desktop view was also inspected. Final mobile checkout measured 425px content within a 425px viewport, with no horizontal overflow. This does not claim physical phone/Safari/payment-authentication acceptance.
- The first fictional `.test` email attempt was rejected at provider initialization and expired without tickets; a fresh `.com` test-address purchase completed. No real money moved. Resend/email setup remains deferred.

Evidence is stored in the sandbox’s `SANDBOX-HOSTED-CHECKOUT-ACCEPTANCE.json` and `SANDBOX-HOSTED-CHECKOUT-SAFETY.json`. The temporary files contain no raw API credentials or private receipt/QR capabilities. No outgoing webhook dispatch was manually run for this upgrade, preserving the earlier scheduled-delivery probe. An additional live validation initially hit a temporary authentication request failure and an approval timeout, then passed on its authorised retry.

Production deployment is **not performed**. The main Vercel project, remote database, keys and existing customer records were not changed. Earlier integration phases’ remote migration/configuration gates still apply. Actual email delivery, physical-device/Safari, scheduled webhook operation, provider refund/recovery, independent load/concurrency and broader production security acceptance remain separate gates; the tests above do not certify them.

## Files and endpoint changes

| Area | Files |
| --- | --- |
| Backend/session security | `lib/integrations/checkout-sessions.ts`, `checkout-sessions.server.ts`, `hosted-links.server.ts`, `hosted-report.ts`; `middleware.ts` |
| Standalone checkout | `app/integrations/checkout/[sessionId]/page.tsx`, `app/checkout/link/[publicId]/page.tsx`, `components/hosted-ticket-selection.tsx`, `hosted-link-start.tsx`, shared `checkout-flow.tsx` |
| Buyer actions and return | New link-start and selection browser routes; existing Paystack initialize/callback and reserve/pay/cancel flows; existing ticket/group components retained |
| Organiser/admin | `components/organiser-hosted-checkout.tsx`, `integration-sales-report.tsx`, `organiser-integrations.tsx`, legacy widget label, private admin integration types/handler/view; organiser hosted-links GET/POST route |
| Maintenance/schema | The two 17 October additive migrations; existing authenticated dispatcher performs bounded prefill cleanup without changing its schedule |
| Docs/examples/tests | Developer guides/OpenAPI/progress; this report; `examples/hosted-checkout/`; `lib/hosted-links.database.test.ts`, `hosted-example.test.ts`, checkout/middleware contract regressions |
| Separate Partner Demo | Existing server/checkout protocol retained; hosted handoff wording and terminal purchase-intent recovery; tests and deployment updated |

The experimental popup-only files/routes/SDK were removed. Existing ticket-selection widgets remain available and are labelled legacy rather than silently removed. Hosted Checkout is shown before API credential controls and is the recommended path. The organiser screen explicitly reports when platform hosted links have not been activated.
