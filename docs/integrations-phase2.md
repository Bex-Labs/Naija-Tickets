# Phase 2 — permitted event, ticket and availability reads

Historical Phase 2 report, implemented 14 October 2026 (Africa/Lagos). Phase 3 subsequently adds configurable isolated resource mode and hosted checkout; see [current progress](integrations-progress.md) and [Phase 3 guide](integrations-phase3.md). This phase adds read-only APIs to the existing integration foundation. It does not add checkout sessions, customer/order/attendee APIs, widgets, webhooks, payments or a separate ticket engine. The Phase 2 contract is [the historical Phase 2 OpenAPI file](integrations-phase2-openapi.json); the Phase 1 contract is historical.

## Organiser setup

Open **Organiser → Developers & Integrations**. Select your organiser and application, assign the events it may access and enable the application. Generate a **Live** key with only the permissions needed:

| Permission | Allows |
| --- | --- |
| `integration:read` | Check the application's identity and supported capabilities. |
| `events:read` | List assigned events and read their public information. |
| `tickets:read` | Read active ticket types, package prices and sale restrictions. |
| `availability:read` | Read available package/admission quantities. |

These permissions are independent. Ticket prices do not require event-list permission; quantities require availability permission. New keys still default to `integration:read` only. Existing keys are not upgraded. Rotation preserves mode and permissions; generate a new key and revoke the old one to change permissions. Store the secret on your server, never in browser code or a mobile app bundle. Origins do not authenticate secret-key calls.

Only assigned events belonging to the same organiser, published and not yet ended, are returned. Draft, submitted, rejected, cancelled, completed, ended, unassigned, foreign and unknown events have the same 404 response. An empty authorised list returns `[]`, not demo events. Event projections contain public organiser ID/name/verified status; they exclude contact email/phone, verification documents, purchasers, QR codes, invite links and private order references. Ticket types exclude inactive tiers and have no inventory counts in the ticket schema.

## Environment isolation

The current database is explicitly a live resource source: the private resource guard authenticates the real credential and accepts **live** mode only. Every authenticated, sufficiently scoped test resource request returns HTTP 503 `SANDBOX_NOT_CONFIGURED`. Test keys may still introspect identity. The former private event-access predicate now also denies test access to live events.

No test-to-live fallback, caller-controlled mode switch, production data copy, new environment variable or sandbox service was added. An isolated sandbox project/deployment and trusted organiser/event mapping remain unprovisioned. Enabling test reads requires a reviewed isolated adapter; adding a test origin does not enable them. Do not use live keys to simulate sandbox purchases. This phase does not make any key capable of purchasing.

## Server requests

Keep `NT_API_KEY` in the caller's server environment. Examples assume Phase 2 source is deployed to Vercel and migration `202610140001_integration_event_reads.sql` has been applied to the same Supabase project. Use the local app origin instead for local verification; no new production deployment was performed by this implementation.

```sh
curl --fail-with-body https://naija-tickets.vercel.app/api/v1/integration \
  -H "Authorization: Bearer $NT_API_KEY"

curl --fail-with-body 'https://naija-tickets.vercel.app/api/v1/events?city=Lagos&category=concert&limit=20' \
  -H "Authorization: Bearer $NT_API_KEY"

curl --fail-with-body "https://naija-tickets.vercel.app/api/v1/events/$EVENT_ID" \
  -H "Authorization: Bearer $NT_API_KEY"

curl --fail-with-body "https://naija-tickets.vercel.app/api/v1/events/$EVENT_ID/tickets" \
  -H "Authorization: Bearer $NT_API_KEY"

curl --fail-with-body "https://naija-tickets.vercel.app/api/v1/events/$EVENT_ID/availability" \
  -H "Authorization: Bearer $NT_API_KEY"
```

All endpoints use GET. Responses include `X-Request-ID`, `Cache-Control: private, no-store`, no-referrer and nosniff. There is no CORS allowance; requests carrying an Origin header are rejected. Existing shared global/IP/key/application/organiser budgets and safe request logs apply to the four new fixed route labels. Logs contain no query, raw key/digest or business response. Dependency/limiter failures remain fail closed. Credentials, scopes and current event grants are rechecked inside the same database read transaction, beyond the route's initial authentication.

Success: `{ "data": ..., "meta": { "request_id": "..." } }`. Lists additionally include `meta.next_cursor`, either an opaque cursor or `null`. Failure: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`.

### Event information

```json
{
  "data": {
    "id": "30000000-0000-4000-8000-000000000001",
    "title": "Lagos Live",
    "slug": "lagos-live",
    "description": "A night of live music.",
    "image_url": "https://example.com/lagos-live.jpg",
    "venue": { "name": "Concert Hall", "address": "12 Example Road", "city": "Lagos", "state": "Lagos" },
    "starts_at": "2026-11-01T18:00:00+01:00",
    "ends_at": "2026-11-01T23:00:00+01:00",
    "timezone": "Africa/Lagos",
    "sales_start_at": null,
    "sales_end_at": null,
    "organiser": { "id": "20000000-0000-4000-8000-000000000001", "name": "Concert Organiser", "verified": true },
    "category": { "id": "10000000-0000-4000-8000-000000000001", "name": "Concert", "slug": "concert" }
  },
  "meta": { "request_id": "50000000-0000-4000-8000-000000000001" }
}
```

Images are public stored event image URLs/paths, or null; no fallback fixture is generated. Unsafe schemes and URLs containing credentials are excluded. Timestamps include timezone offsets; timezone identifies the event's display zone.

### Filters and pagination

`GET /events` accepts `city` (exact, case insensitive; 1–80 characters), `category` (exact lowercase category slug), `starts_from` (inclusive event start), `starts_before` (exclusive event start), `limit` and `cursor`. Dates must be valid ISO timestamps with an explicit offset or Z; up to three fractional second digits. For example `starts_from=2026-11-01T00:00:00Z`. Encode `+` as `%2B` in a query offset.

Lists default to 20 records, maximum 100. Pass the exact `next_cursor` with unchanged filters to obtain the next page. Event ordering is `(starts_at, id)` ascending; ticket ordering is `(sort_order, id)` ascending. Ticket lists accept `limit` and `cursor` only. Detail/availability accept no query parameters. Unknown, repeated, oversized or malformed parameters/cursors return 400. Cursors bind the application, environment, operation, event and filters. They preserve PostgreSQL timestamp microseconds, and are continuation markers, not authorisation tokens; every page rechecks access. Changing `limit` is allowed. Live edits/unpublishing/expiry can change a later page; these are not frozen catalogue snapshots.

### Ticket prices and restrictions

A Squad Pass's `price_kobo: 4500000`, `currency: "NGN"`, `admissions_per_ticket: 5` means **₦45,000 per package for five admissions**, not ₦45,000 for each attendee. `min_packages_per_order` and `max_packages_per_order` use package units; the maximum is also capped by the existing 400-admission checkout limit.

Tickets include ID/event ID/name/short description; current and standard integer kobo price; `price_kind` (`standard` or `early_bird`); nullable early-bird price/deadline; admission multiplier; min/max; effective sale start/end; and `sale_status`. See OpenAPI for the exact schema. `fees_included` and `promo_discount_included` are always false. Checkout remains responsible for final service fees and any submitted promo code. No secret promo code list is exposed.

Current pricing reuses the existing `early_bird_packages_used` definition. Live pending holds and paid/refunded package snapshots consume the configured early-bird quota; expired/released holds do not. Quota exhaustion or deadline expiry switches to standard pricing even if the stored `price_kobo` has not yet been refreshed by checkout. Reads never update it. Unlimited legacy early-bird tiers have a null quota. If the remaining discount allocation cannot satisfy the minimum order, `allocation_limited` reports that temporary price restriction; checkout does not silently split a request between prices.

Sale states: `open`, `upcoming`, `closed`, `sold_out`, `allocation_limited`. Reads conservatively honour both event and ticket sale windows, active tier inventory and order limits. **Existing reservation RPCs enforce ticket windows but do not uniformly enforce event-level sales windows.** They were not changed in this read-only phase; reconcile that inconsistency before Phase 3 external checkout. An open state or advertised quantity is advisory, not a purchase guarantee.

### Availability

`GET /events/{eventId}/availability` returns:

```json
{
  "data": {
    "event_id": "30000000-0000-4000-8000-000000000001",
    "as_of": "2026-10-14T12:00:00+01:00",
    "advisory": true,
    "total_admissions": 50,
    "sold_admissions": 10,
    "reserved_admissions": 0,
    "remaining_admissions": 40,
    "ticket_types": [{
      "ticket_type_id": "40000000-0000-4000-8000-000000000001",
      "admissions_per_ticket": 5,
      "total_admissions": 50,
      "sold_admissions": 10,
      "reserved_admissions": 0,
      "remaining_admissions": 40,
      "remaining_packages": 8,
      "early_bird_remaining_packages": null,
      "max_packages_at_current_price": 6,
      "sale_status": "open"
    }]
  },
  "meta": { "request_id": "50000000-0000-4000-8000-000000000001" }
}
```

Two group-of-five packages consume ten admissions. Paid unclaimed slots remain sold; claims do not restore inventory. Current refunds do not automatically restock admission counters, so the API preserves that policy. Sold values come from existing issuance counters. Reserved values subtract expired unreleased/unconverted holds exactly as checkout cleanup would, without performing writes. Remaining packages round down by the admission multiplier. Event totals sum **active ticket-tier allocations**; there is no new independent event-capacity pool. Off-sale tiers may still have remaining inventory; `max_packages_at_current_price` is zero when purchasing is unavailable and otherwise respects remaining packages, order/400-admission limits and the current discount quota.

An empty event returns an empty ticket list and zero availability, never a fabricated free ticket. A bounded snapshot supports at most 100 active ticket types per event; larger catalogues fail closed with 503 rather than truncate totals. Numeric values outside JavaScript's safe integer range fail closed rather than round a price. No reservation is promised: final checkout must recheck pricing and stock transactionally.

## Error reference

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` / `INVALID_CONFIGURATION` | Invalid query/cursor or server RPC parameters. |
| 401 | `INVALID_API_KEY` | Missing/invalid/revoked/expired/disabled/wrong-mode credential. |
| 403 | `INSUFFICIENT_SCOPE` | This operation's permission is absent. |
| 403 | `BROWSER_ACCESS_DISABLED` | A browser Origin was supplied to a secret-key endpoint. |
| 404 | `NOT_FOUND` | Event unavailable or not authorised, without revealing which. |
| 405 | `METHOD_NOT_ALLOWED` | Use GET; response includes Allow: GET. |
| 429 | `RATE_LIMITED` | Shared budget exceeded; Retry-After gives seconds. |
| 503 | `SANDBOX_NOT_CONFIGURED` | Test business resources are not provisioned. |
| 503 | `INTEGRATIONS_UNAVAILABLE` | Database/limiter outage, unsupported catalogue size or unsafe response data. |

## Verification and rollout

Migration `202610140001_integration_event_reads.sql` expands permitted key scopes/request route labels, replaces the issuer validation without changing rotation semantics, adds four private read helpers and two catalogue/expiry indexes, and closes test access in the reserved predicate. No new business tables, packages, production variables or payment handlers. RLS/private service-role grants remain enforced; browser roles cannot call helpers. Existing Phase 1 keys continue working with their original permissions.

Automated checks exercise real embedded PostgreSQL migrations and existing checkout/finalisation functions, scoped handlers, query/cursor validation, schemas/redaction and error boundaries. They do not constitute independent PostgreSQL concurrency/load testing or end-to-end sandbox purchases. See the progress document for actual final results and linked migration status.

Manual server verification: generate a live read key against your own assigned public event; call the four routes; remove the event assignment and repeat (404); revoke/expire the key (401); use a key missing each scope (403); use a scoped test key (503 sandbox unavailable). Inspect a two-package group purchase's admission counts against the organiser inventory. Do not create a real charge solely for verification. No partner purchase endpoint exists in this phase.

Stop here. Phase 3 requires explicit approval and sandbox/checkout design prerequisites.
