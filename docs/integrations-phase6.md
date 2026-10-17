# Phase 6 — Advanced application operations

Implemented locally on 16 October 2026, at the user's explicit request to proceed before the pending public sandbox purchase. **No deployment, remote migration or real environment configuration was changed.** Phase 3 public purchase/return, Phase 4 durable public receiver/cron and Phase 5 public widget acceptance remain pending. Stop before Phase 7.

## What is available

A partner server can read its application's own orders, purchased ticket status, group registration counts, recorded refunds and verified sales summaries. Attendee names require an explicit permission; email and phone require an additional permission. An optional delegated entry endpoint verifies/checks in only tickets purchased through that application and its currently assigned events.

All routes use the existing `/api/v1` server-key authentication, confirmed creator's current integration-management grant, resource-mode binding, event ownership/grants, rate limits, private/no-store response envelope and safe request logs. Browser requests carrying `Origin` are rejected. A public widget ID, ordinary customer JWT, admin cookie or valid key without the required scope is insufficient. Keys stay on the partner server.

The partner does **not** gain access to all marketplace purchases or other applications belonging to the same organiser. History requires reciprocal `order.integration_checkout_session_id ↔ session.order_id` attribution plus the matching event, organiser, application, current event grant and environment. API-key and widget-originated orders from this application are included. Removing a grant removes this API's history access. Ended/unpublished events can still have authorised financial/ticket history; new partner entry requires a published event that has not ended.

## Permissions

Select only what the external company needs when generating a key in **Developers & Integrations → Key permissions**. No existing key gains permissions automatically; rotations retain existing permissions. Configuration capability metadata is not a permission grant.

| Scope | Data or operation |
| --- | --- |
| `orders:read` | Existing hosted session status, plus this application's order list/details: UUID, event/session UUIDs, state, amounts, dates, admissions and verified/unverified payment state. No buyer details or bearer order reference. |
| `tickets:status` | Individual admission UUIDs, ticket type, order/group UUIDs, status, claim/check-in state, dates and usability. This is distinct from `tickets:read`, which reads public ticket types/prices. |
| `attendees:read` | Registered attendee names and ticket/order/group state for application-attributed orders of an assigned event. Unclaimed slots are excluded. |
| `attendees:contact` | Adds attendee email and phone, **only with** `attendees:read`. A key with contact scope alone cannot list attendees. No purchaser contact, account IDs or verification documents. |
| `sales:read` | Application-attributed aggregate metrics, optionally for one assigned event. |
| `groups:read` | Group admissions, registered/unclaimed/checked-in counts and currently claimable count. No invitation or private member ticket links. |
| `refunds:read` | Recorded refund UUID, state, amount, currency, created/confirmed dates. Read only; no admin reasons, actors, provider refund IDs or provider payloads. |
| `entry:verify` | Verify an application-attributed claimed ticket code using the key creator's existing organiser authority. |
| `entry:check-in` | Admit that ticket, **also requiring** `entry:verify`. Both rights are deliberately explicit. |

Basic order/ticket/status responses never include receipt references, display codes, QR hashes, claim/invitation tokens, payment URLs, signing material or arbitrary database/provider objects. Database DTOs and server serializers both minimise fields. Personally erased attendee fields return `null` with `personal_data_erased: true`, even with contact permission. An ordinary attendee phone can be `null` because existing ordinary checkout does not necessarily collect it per attendee.

## Routes

See [the additive Phase 6 OpenAPI](integrations-phase6-openapi.json).

| Method and route | Scope | Pagination/filter |
| --- | --- | --- |
| `GET /api/v1/orders` | `orders:read` | `event_id` optional; `limit`, `cursor`. |
| `GET /api/v1/orders/{orderId}` | `orders:read` | No query. |
| `GET /api/v1/orders/{orderId}/tickets` | `tickets:status` | `limit`, `cursor`. Includes unclaimed slots with no usable QR. |
| `GET /api/v1/tickets/{ticketId}` | `tickets:status` | No query. |
| `GET /api/v1/events/{eventId}/attendees` | `attendees:read` | `limit`, `cursor`. Contact fields additionally require `attendees:contact`. |
| `GET /api/v1/orders/{orderId}/groups` | `groups:read` | `limit`, `cursor`. |
| `GET /api/v1/orders/{orderId}/refunds` | `refunds:read` | `limit`, `cursor`. |
| `GET /api/v1/sales-summary` | `sales:read` | Optional `event_id`; no pagination. |
| `POST /api/v1/events/{eventId}/check-ins` | `entry:verify`; also `entry:check-in` for admit | JSON `code`, `action`; required `Idempotency-Key`. No query. |

Lists use default 20, maximum 100, ordered by resource UUID ascending (not purchase date), with keyset cursors. Cursor context binds application, mode, scopes, operation and parent/event filter; do not interpret or reuse it on another resource. Pagination is not a snapshot across separate requests. IDs/states can disappear after grant changes. Unknown/duplicate query fields, invalid cursors, unsupported body fields, wrong methods and unsafe IDs fail closed.

Normal success: `{ data, meta: { request_id, next_cursor? } }`. Errors: `{ error: { code, message, request_id } }`. `X-Request-ID`, no-store, no-referrer and existing no-browser CORS rules apply. Typical errors are 400 invalid request, 401 inactive/invalid credential, 403 insufficient scope/browser access, 404 missing or inaccessible resource, 409 idempotency/state conflict, 410 expired entry replay, 413 oversized body, 415 non-JSON body, 429 rate limit with Retry-After and 503 disabled/mismatched/unavailable infrastructure. Unrelated and nonexistent resources have the same safe 404.

## Sales and statuses in plain language

The summary covers **this application's assigned-event transactions only**, not total organiser/platform revenue or remaining event inventory. Use the existing availability endpoint for advisory inventory. Before-payment reservations do not count as sales.

A verified order requires a paid/partially-refunded/refunded order and a matching verified/refunded payment with a verification timestamp, exact stored amount and currency. The existing payment engine remains authoritative. Free checkout is verified through the existing free-payment path.

- `verified_orders`: number of original verified bookings, including those later refunded.
- `ticket_subtotal_kobo`: original ticket subtotal after promo discount, before service fees and refunds.
- `service_fees_charged_kobo`: original charged service fees before refunds.
- `customer_payments_kobo`: original verified totals including fees.
- `completed_refunds_kobo`: recorded completed refunds with provider confirmation. Includes any fee refund within the recorded amount.
- `net_customer_payments_kobo`: original customer payments minus completed refunds, floored at zero.
- `sold_admissions`: valid/used ticket records of currently paid/partially-refunded verified orders, including sold-but-unclaimed group slots; excludes fully refunded orders.

These are receipts/accounting counts, **not organiser payout or platform cash balance**. The API does not invent a fee-refund allocation, provider settlement or net organiser earnings. Refund amounts can be `null` for an older request whose amount has not yet been recorded. Only a `completed` refund with its confirmation date means recorded completion. An order's ordinary status is separate from `payment_status`; never fulfil from `status=paid` without verified payment information. Partner return parameters remain untrusted; use server API status.

Group `unclaimed_admissions` counts all unassigned slots, including those no longer claimable because of a refund/end/privacy erasure. `claimable_admissions` includes only valid unclaimed slots with eligible verified payment, active published future-ending event, and unerased personal information. Each claimed slot is one admission, independent of the package size. No group invitation or attendee QR is disclosed by these reads.

## Delegated entry design

Entry is an additional deployment opt-in. The principal is **the existing key creator**. The application/key/event grant, creator's current management membership, event owner and resource mode are rechecked inside the transaction. A partner cannot supply a staff ID, impersonate an attendee/customer, assign staff, scan another organiser's events, or use this API for tickets sold by another application/marketplace. For a venue-wide scanner, use the existing authorised Naija Tickets entry workflow; this endpoint deliberately has narrower attribution.

Partner entry requires `published` and `ends_at > now()`. It adds no earliest check-in time, so authorised testing/early admission before the event starts remains possible. The ordinary venue entry routine's existing time policy is unchanged. Historical reads remain available when the event has ended, but `usable_for_entry` is false for this partner API. A ticket-state read is advisory and does not reserve or admit anyone.

Submit only a canonical display code and an action:

```sh
# Run on your server with an ignored local environment file.
# Do not paste your key into webpages, browser devtools or shared logs.
curl "$NT_API_BASE/api/v1/events/$EVENT_ID/check-ins" \
  -X POST \
  -H "Authorization: Bearer $NT_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: door-device-001-scan-0001' \
  --data '{"code":"NT-123456ABCDEF","action":"verify"}'
```

`action` is `verify` or `admit`; normalize the scanner's actual ticket code from the existing QR locally. Do not send an entire URL or share the code in telemetry. Bodies are capped at 4 KiB, and extra identity/price/payment fields are rejected. Codes are not returned in the response or stored in the new idempotency/audit data. The response has `ticket_id`, `event_id`, `outcome`, `admitted`, `admission_limit` (1), `admissions_used`, `checked_in_at` and `replayed`; no attendee/contact data.

The existing `verify_event_entry` function does the actual payment/refund checks and locks the order/ticket, writes the existing `check_ins` row, changes ticket/claim state and triggers the existing outbox. The adapter additionally rejects inconsistent payment amounts/currency/verification timestamps. Unclaimed slots have no usable QR and cannot be admitted. Possible outcomes include `valid`, `admitted`, `already_used`, `cancelled`, `refunded`, `unpaid`, `invalid`, `event_unavailable`. A successful HTTP response does not necessarily admit a person: require `outcome=admitted` for an actual new admission, while treating retries as below.

Use a fresh 8–128 character idempotency key (letters/numbers/dots/underscores/hyphens) for each deliberate scan/action. On network loss retry the same action/code/event with the **same** key. Within seven days it returns the original result with `replayed: true` and never inserts another check-in. The same key with a different action/code/event returns 409. Another key for an already used ticket returns `already_used`. Replay is a historical operation result, **not fresh proof of current validity**; do not admit an extra person merely because a previous result says admitted. Current permissions/attribution are still required to retrieve that replay. Expired retained requests return 410; after retention cleanup a new request still uses the existing one-time ticket rule.

The existing shared limits remain 60 requests/key/minute, 180/application, 300/organiser, plus global/trusted-IP budgets. Entry adds 30/key and 120/organiser per minute across verification/admission, failing closed if unavailable. Each application's retained entry table is capped at 10,000 rows; a mutation deletes up to 100 of that application's expired rows. Seven-day retention and these conservative budgets are for initial limited-volume use, not an event-scale throughput certification. No paid service or distributed offline scanning is introduced.

Application `FOR NO KEY UPDATE` serialises new idempotency rows while allowing the existing refund/outbox foreign-key `KEY SHARE`. A stronger `FOR UPDATE` caused a real native PostgreSQL entry/refund deadlock during development; the corrected lock passed the independent-connection race test. Audit metadata records the actual creator, application, key, event, mode, ticket and outcome, without QR/contact data.

## Existing group claims, refunds and cancellation

Group claiming remains on the buyer's existing booking/registration flow. The same email or normalized phone cannot claim twice; the existing transaction/locks serialize last-slot races. API status can follow reserved → claimed → checked-in without receiving an invitation or private ticket token. This phase adds **no machine group-claim write or QR export**, because that would need a distinct recipient/consent and bearer-delivery design.

Refunds remain the existing admin-authenticated provider-verification/recording operation. This phase exposes only permitted status and amount, not initiation, approval or an administrator bypass. The API does not add event/ticket cancellation, bulk staff assignment or paid-order cancellation. Existing hosted create/status/cancel UI still works; cancelling an unpaid checkout releases its hold through the existing engine and is not a refund. No new partner cancellation write route is advertised.

## Migration, configuration and rollout

Migration: `supabase/migrations/202610160003_integration_operations.sql`, after all preceding migrations, including Phases 1–5, the guest privacy routines and organiser-isolated entry routine. It extends scope/log allowlists without changing existing key scopes, adds one private RLS-protected entry idempotency table, scoped service-only read/entry RPCs and internal projections. No new order/payment/ticket ledger, credential secret, dependency or backfill is introduced. There are no historical entry-request records to migrate. Existing read/write RPC signatures remain compatible.

A targeted compatibility fix extends the existing guest eraser: it keeps unclaimed identity columns null, removes claimed attendee phone/contact matching keys, and prevents an erased group's old invitation from collecting new attendee details. It preserves issued ticket validity, QR capabilities and accounting/check-in history. This was necessary because the old pre-group eraser violated the unclaimed-slot constraint and omitted group-member phone data. The migration verifies expected function definitions before applying these small replacements; it fails rather than guessing if they differ. No guest data was erased outside fictitious tests.

Both server-only flags default disabled in `.env.example`:

```dotenv
INTEGRATIONS_ADVANCED_ENABLED=false
INTEGRATIONS_ENTRY_ENABLED=false
```

For the **separate sandbox only**, rehearse the additive migration with fake data, deploy the tested source, verify its distinct Supabase/test Paystack/resource binding and trusted APP_URL using the Phase 3 guide, then deliberately enable advanced reads. Enable entry separately only when delegated scanning is ready to test. Create sandbox keys there with the minimum explicit scopes. Do not reuse the main application's data or treat a Test prefix as isolation. The separate sandbox and Partner Demo folders were not edited or deployed in this phase.

An organiser can then use their server key from Postman/curl or a backend request:

```sh
curl "$NT_API_BASE/api/v1/orders?limit=20" -H "Authorization: Bearer $NT_API_KEY"
curl "$NT_API_BASE/api/v1/orders/$ORDER_ID/tickets" -H "Authorization: Bearer $NT_API_KEY"
curl "$NT_API_BASE/api/v1/events/$EVENT_ID/attendees" -H "Authorization: Bearer $NT_API_KEY"
curl "$NT_API_BASE/api/v1/sales-summary?event_id=$EVENT_ID" -H "Authorization: Bearer $NT_API_KEY"
```

Use only a public sandbox origin and fixture IDs for acceptance. Make an actual sandbox purchase through the existing hosted/widget flow, find its order UUID through the attributed order list, compare it with the buyer/organiser records, claim a group ticket through the normal registration page, then verify/admit its actual code. Check an unrelated application, removed event grant, missing name/contact/entry scope, disabled/revoked/expired key, refund, ended event and repeated scan. No endpoint should reveal raw capabilities or unrelated records. Observe the previous phases' public purchase/return and webhook gates separately; API fixtures do not complete them.

## Verification

Run `npm test`, `./node_modules/.bin/tsc --noEmit --incremental false`, `npm run lint` and `VERCEL=1 NITRO_PRESET=vercel npm run build`. Focused checks: `node --test lib/integration-operations.test.ts lib/integration-operations.database.test.ts`.

The existing explicit disposable PostgreSQL concurrency harness additionally tests simultaneous same-key and different-key admission, refund/check-in races, duplicate group contact and competition for the final slot. Use the strictly guarded disposable database instructions in the Phase 3 guide; never point it at an existing database. Tests use fake data and mocked verified payment results, not real charges or public deployment evidence.

Final command results, route/bundle checks and remaining operational gates are in [the progress report](integrations-progress.md). Phase 7 requires a separate request.
