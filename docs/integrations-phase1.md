# Phase 1 — developer applications and API credentials

Historical Phase 1 report. Phase 2 now adds read scopes and live event/ticket/availability APIs; see [the current guide](integrations-phase2.md) and [current OpenAPI](integrations-phase2-openapi.json). The scope/capability examples below describe Phase 1.

Phase 1 started 13 October 2026 and completed 14 October 2026 (Africa/Lagos). This is the credential/configuration foundation only. The public event API, external checkout sessions, widget, outgoing webhooks and partner ticket operations are not implemented. The existing reservation, Paystack, ticket issuance and entry routes were not changed.

## Using the organiser dashboard

1. Sign in with a confirmed organiser account and open **Organiser workspace → Developers & Integrations**.
2. Choose an authorised organiser account and enter an application name.
3. Register exact website origins, one per line. Live origins require HTTPS. Test origins may use HTTP localhost (`localhost`, `127.0.0.1` or `[::1]`). Paths, query strings, credentials and wildcards are rejected. Registration is configuration, not proof of DNS ownership and not API authentication.
4. Select the organiser's events the application may access in future API phases; none are assigned by default. Assigning a draft does not publish it or make it retrievable through an API.
5. Register the application, then generate a Test or Live API key. Expiry defaults to 90 days; the dashboard offers 30, 90 or 365 days. Only `integration:read` is available. Clearing it creates a key with no usable endpoint permissions.
6. Copy the secret once and keep it on your server. It is never recoverable from the dashboard or stored in plaintext. The browser component holds the creation response in memory only; refresh, switching applications or dismissing it clears the secret.
7. Rotate to create a replacement and immediately revoke the old key; rotation preserves mode and scopes and gives a fresh 90-day expiry. A lost creation/rotation response does not permit secret recovery: refresh metadata and rotate again or revoke the newly listed key.
8. Revoke unused keys, or disable the application to block all of its keys. Re-enabling an application allows its still-valid, non-revoked keys again. Removing an issuer's membership or management permission permanently revokes their keys; restoring the permission does not resurrect them.

Existing unambiguous `Owner` memberships receive `can_manage_integrations`. Ordinary customer accounts, entry staff and other organiser members do not receive this permission. Future first, server-created Owner memberships are bootstrapped by a trigger; subsequent members are not auto-granted. Delegating management currently requires a trusted platform administrator/service operation; no self-grant or collaborator-management UI is exposed in this phase.

Limits: ten registered applications per organiser; twenty active, unexpired keys per application; twenty origins and one hundred event assignments per application. Metadata includes all active keys within a latest seventy-record history window (active entries are prioritised). No raw secret, digest, buyer/attendee information, identity document, order reference or QR code is in the dashboard API responses.

## Server-to-server connection test

Only `GET /api/v1/integration` is usable with a secret key in Phase 1. `nt_test_...` and `nt_live_...` credentials have distinct, immutable modes. Reserved `nt_widget_...` identifiers are public metadata and cannot authenticate this endpoint.

Use a temporary environment variable on your server; do not paste the real key into frontend code, chat, screenshots, source control or command history:

```sh
read -s NT_API_KEY
export NT_API_KEY
curl --silent --show-error \
  --header "Authorization: Bearer $NT_API_KEY" \
  https://naija-tickets.vercel.app/api/v1/integration
unset NT_API_KEY
```

The hosted URL requires deploying the updated source first. For localhost testing, replace the origin with your local server. Do not send an `Origin` header: secret credentials are server-to-server, not a browser integration method. Registered origins will govern later hosted returns/embedding; they do not enable CORS on secret-key endpoints.

Example response (identifiers are illustrative):

```json
{
  "data": {
    "id": "20000000-0000-4000-8000-000000000001",
    "name": "My event website",
    "organiser_id": "10000000-0000-4000-8000-000000000001",
    "environment": "test",
    "scopes": ["integration:read"],
    "key_id": "30000000-0000-4000-8000-000000000001",
    "expires_at": "2027-01-11T00:00:00+00:00",
    "capabilities": {
      "introspection": true,
      "event_api": false,
      "hosted_checkout": false,
      "widget": false,
      "sandbox_purchases": false
    }
  },
  "meta": {"request_id": "40000000-0000-4000-8000-000000000001"}
}
```

All application-managed API responses include `X-Request-ID`, private/no-store caching, no-referrer and nosniff. Failures have `{error: {code, message, request_id}}`. Dependency/limiter outages fail closed with 503. Invalid, revoked, expired, disabled or wrong-mode credentials get the same generic 401; missing scopes get 403. Rate-limited responses include `Retry-After`. Some cross-origin calls in the Vite development server may be blocked by Vite before reaching the application; production handlers do not grant CORS access either.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST`, `INVALID_CONFIGURATION` | Malformed configuration, unsupported scope or expiry. |
| 401 | `AUTHENTICATION_REQUIRED`, `INVALID_API_KEY` | Dashboard JWT required, or no valid machine credential. |
| 403 | `FORBIDDEN`, `EMAIL_CONFIRMATION_REQUIRED`, `INVALID_ORIGIN`, `BROWSER_ACCESS_DISABLED`, `INSUFFICIENT_SCOPE` | Missing permission/confirmation, unsafe caller or insufficient scope. |
| 404 | `NOT_FOUND` | Out-of-tenant/unknown application or key, or an unavailable API endpoint. |
| 405 | `METHOD_NOT_ALLOWED` | Machine introspection accepts GET only (`Allow: GET`). |
| 409 | `INTEGRATION_DISABLED`, `KEY_LIMIT_REACHED`, `INTEGRATION_LIMIT_REACHED` | Application state or registration/key limit. |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Management bodies are bounded to 16 KiB and require JSON. |
| 429 | `RATE_LIMITED` | Shared budget exhausted. |
| 503 | `INTEGRATIONS_UNAVAILABLE` | Server configuration, database or rate limiter unavailable. |

Only implemented endpoints are available; authenticated calls to future `/api/v1/events` etc. receive `NOT_FOUND`. Neither test nor live credentials can create an order or invoke payment/entry/admin operations. Do not use these credentials as Supabase JWTs or customer account authentication.

## Implemented routes

| Route | Authentication / operation |
| --- | --- |
| `GET /api/organiser/integrations` | Confirmed Supabase JWT; safe metadata for explicitly managed organisations only. |
| `POST /api/organiser/integrations` | JWT + management grant; application registration. |
| `GET /api/organiser/integrations/{id}` | JWT + tenant management grant; one safe application projection. |
| `PATCH /api/organiser/integrations/{id}` | JWT + grant; configuration/status/event assignments. Owner cannot be changed. |
| `POST /api/organiser/integrations/{id}/keys` | JWT + grant; create `{environment, scopes, expiresInDays}` credential. |
| `POST /api/organiser/integrations/{id}/keys/{keyId}/rotate` | JWT + grant; rotate atomically, preserving mode/scopes. |
| `POST /api/organiser/integrations/{id}/keys/{keyId}/revoke` | JWT + grant; revoke without deleting audit history. |
| `GET /api/v1/integration` | Machine bearer key + `integration:read`; safe current identity/capabilities. |
| `/api/v1/{unimplementedPath}` | Versioned boundary rejects unavailable operations; no business API has been added. |

Configuration body example: `{organiserId, name, status: "active", domains: [{environment: "test", origin: "http://localhost:3001"}], eventIds: []}`. The server obtains the user from verified Supabase auth; callers cannot supply the issuer identity. Machine keys cannot manage applications/credentials.

## Database and security

Migration: `supabase/migrations/202610130001_integration_foundation.sql` (applied to the linked project during Phase 1).

- Adds the membership management flag; new private `integrations`, `integration_domains`, `integration_event_grants`, `integration_api_keys`, `integration_rate_buckets`, `integration_request_logs` tables.
- Owner backfill was reviewed using aggregate counts: three Owner memberships, zero other memberships, zero ambiguous Owner groups. The applied column reports three managers. No private contact/identity data or raw credentials were printed.
- Keys use 32 cryptographically random secret bytes and a distinct random UUID identifier; the full credential is SHA-256 hashed. Public display contains only a prefix and four-character suffix. Scopes and mode are stored and checked, not trusted from request JSON.
- Private mutating RPCs validate management permission independently of the route. Permission rows are held during credential/configuration writes; grant-loss triggers revoke issued secrets permanently. Rotation and revocation lock the application/key and audit the action transactionally.
- Event grants verify event and integration organisation at write time. The reserved private event-access predicate checks current assignment, ownership, credential, scope, published status and end time. It is not a resource endpoint or sandbox resolver; Phase 2 must add environment binding and resource scopes before using it for business reads.
- All six tables have RLS and no anonymous/authenticated browser grants; all new RPCs and metadata helpers explicitly revoke PUBLIC/anon/authenticated EXECUTE and allow service-role calls only. Metadata functions never return digest/raw secrets.
- Request logs contain request/key/application identifiers, a fixed route label, status, error code and elapsed time only. They exclude payloads, request URL queries, credentials and customer information; older-than-thirty-day rows are purged opportunistically in bounded batches on logged requests. Successful calls update the key's last-used date.
- Rate limiting is a PostgreSQL atomic fixed-window counter: 600/minute global pre-auth ceiling (also used by the management boundary), 60/minute per trusted Vercel IP, 60/minute per key, 180/minute per application, 300/minute per organiser. Management writes/reads additionally have 30/minute per signed-in user. Proxy IP headers are trusted only on Vercel, hashed before the temporary bucket is stored; outside Vercel the global ceiling remains. This is not an unlimited per-process memory map or a paid rate-limit service.
- Rate buckets expire after two windows and bounded cleanup runs on requests. These protections are a foundation, not a claim of internet-scale DDoS protection; budgets need measured tuning before broad launch.
- RPC calls have an eight-second timeout. Usage recording is best effort and cannot change an authenticated result; authentication/rate-limit failures do not fall open.

No sandbox business project/deployment, new environment variable, paid service, production deployment, payment flow change or administrative password change was introduced. Test keys can verify control-plane integration identity only. Sandbox resource mapping and real purchase isolation remain mandatory gates for later phases. Existing admin login hardening and independent multi-connection PostgreSQL load/race tests remain outstanding before broad partner launch.

## Validation and limitations

- Focused Node/PGlite tests cover credential entropy/format/digest, origin/body/scope validation, owner backfill/new-owner compatibility, staff/customer denial, cross-organiser access, event grants, key mode/expiry/rotation/revocation, restoration after issuer removal, private table/function grants, shared rate budgets, API error/CORS/limiter failure handling and safe metadata/logging.
- The full suite, TypeScript, lint and Vercel build results are recorded in `integrations-progress.md`. Native server credential/digest helpers were checked to be absent from generated browser JS.
- Local Vinext HTTP probes verified unauthenticated/invalid credential 401, unsupported-method 405, cross-origin 403 without CORS exposure, machine-key rejection at dashboard routes, ordinary checkout's malformed-body 400 and homepage 200. No order, charge or email was created.
- A separate Vite preview used the actual dashboard component/CSS with disposable in-memory mock responses, not production registrations. Browser checks covered configuration/event selection, key secret display/dismissal, rotation, revocation, disable controls and selection of a saved application. No horizontal overflow at 320px/390px. After initial dependency optimisation, a fresh browser load had no captured warning/error logs.
- Browser preview actions do not prove authenticated end-to-end production API operation. Real key lifecycle/storage and authorisation were verified in embedded PostgreSQL and handler tests. Real remote dashboard registration/key creation was not exercised automatically, and no demo integrations or API keys were left in the linked project.
- An initial concurrent build had a dependency-tracing failure; a subsequent standalone Vercel build passed. Supabase reported a non-fatal Docker/pg-delta catalogue-cache warning after applying the migration; the new column and application RPC/rate limiter were independently verified. The CLI's management-query command also lacked a PAT; the reviewed aggregate ownership counts were obtained safely through the app's existing server connection instead.

## Next phase

Phase 2 is not started. It will add permitted event/ticket/availability reads, resource scopes, pagination and schemas. Before enabling test resource access, configure and approve an isolated sandbox resource binding; never silently fall back to production. Await a new user approval.
