# Phase 4: outgoing webhook notifications

Implemented 16 October 2026. This phase adds durable notifications to the existing checkout/ticket engine. It does not add widgets, advanced partner data APIs, another payment ledger or a refund initiation API. Public deployment and real scheduled-delivery acceptance remain pending. Phase 5 is not started.

## What an organiser can do

Open Organiser workspace → Developers & Integrations → select an application → Webhook notifications. Register the exact public HTTPS website origin in the appropriate Test/Live origins first. Add its receiver URL, select the deployment's environment and subscribe to supported updates. Save the one-time signing secret on the receiver's server; the dashboard hides it after one minute and never retrieves it again.

The UI shows endpoints and delivery history, with 20 deliveries per page and expandable attempts. Pause/enable endpoints, rotate their signing secret, retire an endpoint, or queue an exhausted delivery for retry. Rotation also pauses the endpoint: update the receiver's secret, then enable it. Retirement keeps history and stops outstanding work; create a new endpoint to change its immutable destination/subscriptions. There are three non-retired endpoints and twenty lifetime endpoint records per application. History is never exposed to API keys, customers, other organisers or browser database roles.

Revoking an integration manager also pauses endpoints they created and increments their configuration revision. Regranting management permission does not automatically enable them. Disabling an application, removing an event grant/origin, changing resource mode, pausing/retiring or rotating an endpoint prevents future authorised sends. A request already sent over the network cannot be recalled; receivers must retain their own idempotency protection.

## Supported business events

| Type | Authoritative transition | Extra data |
| --- | --- | --- |
| order.created | Existing reservation linked to its hosted checkout session | None |
| order.paid | Order changes to paid with matching verified payment, including existing free checkout | amount_kobo, currency |
| group.admissions_reserved | Paid group booking creates reserved admission slots | group_booking_id, admissions |
| ticket.issued | Usable ordinary ticket inserted, or an unclaimed group slot becomes claimed | ticket_id |
| ticket.checked_in | Authorised entry creates the existing unique check-in record | ticket_id, checked_in_at |
| refund.completed | Existing provider-verified refund becomes completed | refund_id, amount_kobo |

Every data object also contains checkout_session_id, order_id and event_id. There are no customer names, email/phone details, receipt references, QR codes/hashes, claim capabilities, invite tokens or ticket-access links. A group purchase counts sold admissions immediately but emits no ticket.issued for unclaimed slots. Payment failures/amount mismatches and expired holds do not emit payment or usable-ticket success. Failed payment attempts are not labelled definitive failed orders. Cancellation events are not invented.

Only orders actually linked in both directions to an integration checkout are attributed. The event grant, organiser ownership, resource mode and active application must match. Existing marketplace orders have no partner attribution and emit nothing. The migration does not backfill historical transitions.

## Atomicity and delivery contract

Deferred database triggers inspect the final committed reservation/payment/claim/entry/refund state. The business change, immutable event body and initial event/endpoint delivery rows commit together. A rolled-back purchase has no outbox event; an application process can stop after commit without losing queued delivery. Unique application/type/resource and endpoint/event constraints suppress duplicate callback/claim notifications. No network request or secret decryption happens inside a purchase transaction.

Events are recorded even if no endpoint subscribes, but deliveries are created only for matching enabled endpoints at the transition. Adding/enabling an endpoint does not automatically replay earlier events or events missed while paused. An already queued delivery waits while paused. History retry does not let managers redirect old payloads to arbitrary URLs.

Delivery is **at least once**, and ordering is not guaranteed. Deduplicate the immutable top-level event ID, and do not allow a delayed order.created notification to downgrade a verified paid booking. Respond with 2xx only after durable inbox insertion/business processing. There is no exactly-once or immediate delivery guarantee.

Workers claim up to five rows using FOR UPDATE SKIP LOCKED and a unique 120-second lease. Concurrent workers cannot claim the same unexpired job. Every claim records an attempt before network activity. An expired lease records lease_expired and can be recovered; a stale worker cannot finish another worker's lease. Endpoint revision/current permissions are checked again immediately before sending.

Each invocation processes at most four batches (20 jobs), five at a time, and stops taking batches after a 17-second work window. Each database call has an 8-second timeout; DNS has a 2-second deadline and HTTPS a 5-second deadline. The Node/Nitro Vercel function limit is 60 seconds. A hard process stop leaves recoverable leases rather than relying on a fire-and-forget continuation. A failed completion write can mean the receiver accepted the event but the sender retries it.

2xx succeeds. HTTP 408/425/429 and 5xx retry with exponential backoff and jitter (initial minimum about 30 seconds, capped at one day); bounded Retry-After is honoured. Redirects and other non-2xx statuses are permanent failures and are not followed. Network/timeouts/configuration failures retry; unsafe destinations exhaust immediately. After eight automatic attempts a job exhausts. A manager can grant up to three additional retry rounds, bounded to 32 total attempts across all rounds. Attempt history stores only fixed outcome labels and HTTP status, never response bodies/headers, URLs, raw exception text or secrets.

## Free Vercel scheduler

The user confirmed Hobby/free. The committed vercel.json schedules a daily GET to /api/internal/integrations/dispatch at 04:00 UTC (05:00 Africa/Lagos). Vercel Hobby timing can vary within the hour. [Official scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

This is deliberately low-volume: at most 20 deliveries per daily invocation, with retries sharing that budget. Each ticket issuance and endpoint subscription creates additional work. A backlog can take multiple days to drain; backoff is a minimum eligibility delay, not an execution promise. Manual retry queues work for the next dispatcher; it does not immediately send it. Do not launch time-sensitive/high-volume integrations under this schedule. No paid queue or upgraded plan is provisioned. A higher-frequency compatible scheduler requires a separate operational decision before promising faster delivery.

GET supports Vercel Cron; POST supports an explicitly configured external scheduler or an operator's manual invocation. Both require Authorization: Bearer <CRON_SECRET>; no query-string credential or unsigned dashboard trigger is supported. The endpoint is a bounded queue drain, not a caller-controlled URL/payload proxy. Source cron configuration alone is not proof of a running scheduler: confirm an actual production-deployment cron invocation and durable delivery result before accepting this gate.

## Secrets and SSRF controls

Set server-only INTEGRATIONS_WEBHOOK_ENCRYPTION_VERSION=v1 and INTEGRATIONS_WEBHOOK_ENCRYPTION_KEYS to a JSON object containing a dedicated random 32-byte base64url AES key (43 characters). The active version must exist; at most three versions are supported. Set a separate random CRON_SECRET of at least 43 characters and INTEGRATIONS_WEBHOOKS_ENABLED=true only when ready for the sandbox test. Do not reuse the hosted checkout, admin, Supabase, Paystack or scheduler secret as an encryption key. No new actual secrets are generated, copied to Vercel or printed by this implementation.

Endpoint signing secrets are independently random whsec_ credentials. Only AES-256-GCM ciphertext is stored. AAD binds endpoint ID, application ID and environment, preventing ciphertext copying across endpoints/tenants/modes. Authentication tags and encoding are validated. For master-key rotation, add the new version while retaining old versions, select it for new endpoint writes/rotations, then rotate/reconfigure all old endpoints before removing their old master key. Removing an old key prematurely prevents decryption and records configuration_error; it does not send unsigned traffic. Back up encryption material privately: API key hashes cannot recover webhook signing secrets.

Only public HTTPS DNS hostnames on an application's exact registered origin are accepted, with default TLS port and no query, fragment, userinfo or wildcard. Localhost, IP literal tricks, internal names, private/link-local/metadata/documentation/multicast ranges, IPv4-mapped IPv6 and transition networks are rejected. Registration resolves DNS; every attempt resolves it again, rejects the entire answer set if any address is unsafe, and pins a checked address into that request's socket lookup. TLS validation/SNI retain the original hostname. Connection pooling/proxy inheritance and redirects are not used. No production localhost exception exists, even for Test mode. The receiver must be publicly reachable HTTPS for deployed acceptance.

## Receiver signature

Headers:

```text
Naija-Webhook-Id: <immutable event UUID>
Naija-Webhook-Timestamp: <Unix seconds, refreshed for each attempt>
Naija-Webhook-Signature: v1=<lowercase HMAC-SHA256 hex>
Content-Type: application/json
```

Sign the exact UTF-8 body with the literal whsec_ secret over:

```text
event_id.timestamp.raw_body
```

Use constant-time comparison, a maximum five-minute timestamp skew, and verify before JSON parsing. Check header/body ID agreement, expected integration ID/environment and api_version=2026-10-16. Persist/deduplicate the event ID and payload hash atomically in a durable database before returning 2xx. Duplicate IDs with changed bodies must not overwrite accepted work. Read bodies with a size/deadline limit. Do not log the signing secret or private request headers.

lib/integrations/webhook-receiver.ts is an executable reference inbox for a persistent Node server. Its SQLite transaction/unique ID survive process restart; an application worker can consume stored events separately. Its tests verify raw signatures, replay/identity rejection, duplicate persistence across restart, size bounds and storage-error retry. **Do not use local SQLite as durable storage in Vercel Functions.** A deployed Partner Demo receiver needs a separately configured durable inbox and the new endpoint secret. The existing Partner Demo still returns 501; it has not been silently changed or claimed as a successful public receiver.

## Management routes

All routes below require a confirmed organiser JWT, same-origin dashboard requests and explicit integration management permission. Existing shared rate limits, bounded JSON, safe error envelopes/request IDs and private/no-store responses are reused. Server API keys cannot configure endpoints or inspect history.

| Method | Route suffix under /api/organiser/integrations/{id} | Behaviour |
| --- | --- | --- |
| GET | /webhooks?before=<last delivery UUID> | Safe endpoint metadata and 20 deliveries with attempt history; nextCursor |
| POST | /webhooks | environment, url, events; returns ID and signing secret once |
| PATCH | /webhooks/{endpointId} | enabled boolean, optional rotate boolean; returns a new secret only on rotation |
| DELETE | /webhooks/{endpointId} | Retire without deleting history; queued work stops |
| POST | /webhooks/deliveries/{deliveryId}/retry | Bounded retry of an exhausted delivery |

Keep the inbox/outbox/history private. They are not part of the public event/read API or normal admin/customer projections. Events and attempts are retained until an explicit operational retention job is chosen; no automatic deletion or unbounded scheduler cleanup was added. Database administrators should plan monitored retention before broad launch.

## Rollout and remaining acceptance

1. Review the additive 202610160001_integration_webhooks.sql migration. Rehearse on the isolated sandbox first; retain the previous 37 migrations and the actual sandbox test resource binding. The Phase 4 migration/config changes are in the main source working tree; they have not been copied to the separate sandbox folder, applied remotely or deployed automatically.
2. Deploy the sandbox backend separately, including this phase's reviewed source/migration. Keep the main Supabase/live project separate. Configure the dedicated encryption and cron secrets privately on that deployment. No secret is a NEXT_PUBLIC_ variable. Set feature flag only after configuration.
3. Configure a real public sandbox receiver with a durable database, register its exact Test origin and endpoint, save its one-time signing secret privately, then complete an ordinary and a group Paystack test purchase. Verify event IDs/counts and redacted payloads against the sandbox order/ticket state. Receiver failure must not prevent committed payment or ticket issuance.
4. Observe a real scheduled invocation after disconnecting the purchase browser. Confirm due jobs lease, delivery reaches the receiver, durable inbox deduplicates retries, and history updates. Test receiver 500/429, recovery and duplicate acceptance; pause/revoke and confirm future sends stop. Confirm real network/TLS behaviour against public DNS, not just fixtures.
5. Finish the pending online Partner Demo → separate sandbox → test payment → verified return test. Email remains deferred by the user. Do not mark public Phase 3/4 operational acceptance passed until observed. Stop before Phase 5.

The committed tests use embedded PostgreSQL and independent PostgreSQL connections plus local receiver fixtures; they do not prove Vercel cron activation, a deployed inbox, public TLS delivery, payment-provider webhooks or production throughput. See integrations-progress.md for actual results and unresolved gates.
