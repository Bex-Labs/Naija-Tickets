# Phase 7 — Developer experience and readiness

Implemented and verified locally on 16 October 2026. **Public purchases/manual delivery passed; automatic and cross-device acceptance is incomplete.** The user authorised Phase 7, then work on the remaining sandbox. This report distinguishes tested source from deployed functionality. The separate sandbox was on Phase 3 at the start of this work. Following Phase 7 verification, its source was synchronized and the four Phase 4–7 migrations were applied; earlier public payment, receiver, scheduled-delivery and physical-device gates remain pending. Email testing remains deferred.

## Developer-facing implementation

The footer's **Developers** link opens `/developers`. Guides cover getting started, authentication, hosted checkout, widget installation, webhooks, isolated testing, security, errors and FAQ. The expandable API reference includes actual methods, scopes, parameters and response codes, and downloads `/api/v1/openapi.json`. Examples use server-side secrets and environment variables; there is no browser secret-key console. No public admin sign-in link was added.

The OpenAPI 3.1 document combines implemented Phase 3–6 contracts with namespaced references. It has 20 public path patterns, unique operation identifiers, current permissions/configuration metadata and the outgoing webhook receiver contract. Private organiser management, admin and dispatcher paths are excluded. The schema alone permits public cross-origin reads; this does not enable browser access to secret-key APIs. Existing phase-specific schemas remain historical/implementation references.

Fixed widget appearance options now complete the earlier customization requirement: light/dark, green/blue/violet accent, rounded/square button. Organisers choose them when copying a snippet; the external example includes the same controls. The loader and iframe accept only these enumerated options, without arbitrary CSS or new private messages. Existing snippets retain defaults. Appearance does not alter price, authority, admission counts or checkout verification.

## Private administration

The existing admin workspace adds **Integrations**: bounded application/organiser search, status filters, pagination, aggregate authenticated request/error counts for the last 24 hours, pending/exhausted deliveries, recent request metadata and selected security audit events. It excludes keys, digests, contacts, private ticket links and provider payloads. Unknown-key/browser-widget rejections remain in safe server logs rather than being attributed to an authenticated application.

Suspension requires the current admin password, same-origin JSON request and a reason. It atomically disables the application, revokes existing keys and pauses widgets/outgoing endpoints. The organiser cannot undo an admin suspension. Restoring clears the administrative lock but leaves the app disabled: its owner must explicitly reactivate, issue fresh credentials and configure widgets/endpoints again. Restoration does not resurrect credentials. Already authorised payments and paid receipts still finish through the existing engine. Audit events identify the acting admin. API credentials cannot administer integrations.

## Authentication readiness fixes

The initial audit identified fast admin password hashing and missing shared login limits. New/updated admin passwords use Node's built-in scrypt, N=131072, r=8, p=1, 64-byte output and a bounded memory budget. These parameters follow [OWASP's scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Strictly validated legacy hashes still verify; successful stored-account login upgrades the hash with a compare-and-swap RPC. Concurrent upgrades cannot overwrite a newer password. Environment-only legacy credentials continue to work until changed through existing Settings.

New signed admin cookies are bound to the current account hash, expire within eight hours, and fail after password changes/account removal. Existing cookies require signing in once after rollout; passwords are not reset. Changing one's password refreshes that browser's cookie. Authoritative stored-account lookup failures fail closed instead of falling back to an old environment password.

Login JSON is capped at 4 KiB; fields and password length are bounded. Shared limits are 20 global attempts/minute, eight per hashed account/minute and eight per trusted hashed Vercel IP/minute when available. Failed limiter/storage access denies login. Oversight also has a per-admin budget. This is not a claim of MFA, a security audit of every historical route or event-scale throughput certification.

## Database and configuration

Additive migration: `202610160004_integration_readiness.sql`, after all earlier migrations. It adds suspension metadata, private service-only oversight/CAS RPCs, a suspension guard on the existing organiser updater and bounded login limiter forms. No new payment/ticket ledger, dependency, password reset, customer deletion or historical business-data backfill is introduced. The full migration sequence was rehearsed with fictitious records. **No remote migration or real environment change was performed as part of Phase 7 implementation.**

Apply the migration before deploying the hardened login code: its limiter/CAS functions depend on that schema. Follow [the rollout and recovery runbook](integrations-rollout.md). Main and sandbox remain different projects. Do not rerun old migration files or reset a linked database.

`npm run integrations:readiness` checks local structural configuration and operator-recorded evidence without network access, mutations or secret output. Optional: `npm run integrations:readiness -- docs/integrations-acceptance.json`. Exit 1 means incomplete/disabled/invalid checks; it is expected before public acceptance. A flag being disabled is not a successful acceptance result. Secret prefixes prove neither connectivity nor ownership.

Evidence must have schemaVersion 1, exact public deploymentOrigin, matching test/live environment, and each gate's status `passed`, valid verifiedAt and a meaningful non-sensitive evidence reference. The checker cannot certify the truth of operator evidence. Keep screenshots/logs free of secrets, private QR codes, contacts and bearer links. Do not mark gates passed from mocks or a different deployment.

## Verification results

| Check | Result |
| --- | --- |
| Full `npm test` | 322/322 passed; no failures/skips. Includes existing marketplace and Phases 1–6 regression. |
| Focused readiness/widget suites | 21/21 passed. |
| Native disposable PostgreSQL concurrency | 14/14 passed, including parent and 13 scenarios. Cluster stopped/removed afterward. |
| TypeScript, lint, Vercel-target build | All exit 0. |
| Compiled preview | Public guides/reference/schema, admin authentication and scheduler denial checked against a remote-blocked, in-memory fixture. 20/20 checks passed. |
| Browser | Actual compiled portal/admin controls at 390px, reference at 320px and portal at desktop width. Admin fixture login, activity and suspension completed. Dark/violet/square widget rendered at 320px on an external origin. No horizontal overflow observed. |
| Readiness command | Exit 1 as expected: public evidence/activation pending. No credentials printed. |

Database tests cover service-role denial, safe aggregation/search/cursors, selected audit fields, atomic suspension/restore, no credential resurrection, preservation of previously authorised payment callbacks/receipts, null/stale CAS rejection and exact limiter caps. Independent PostgreSQL connections additionally exercise suspension versus key issuance, simultaneous hash upgrades and distributed login budgets, alongside existing oversell/payment/refund/check-in races. Bounded local concurrency tests are not production load tests.

The local browser used fictional records and a disposable service gateway that blocked remote server requests. Existing admin overview services absent from that narrow fixture displayed load warnings; the new Integrations screen's requests succeeded. The widget fixture used real handlers/SQL and a labelled hosted landing stub, not a provider payment. Temporary views are not public sandbox acceptance.

## Remaining acceptance

An external developer's complete online journey is not yet demonstrated. The separate sandbox source sync, 322-test run, types/lint/build and four additive remote migrations are complete; read-only test binding/permissions/history checks passed. Remaining: deploy it with test-only secrets and exact origins, connect Partner Demo securely, complete an actual public verified Paystack test purchase and return, verify ordinary/free/group issuance/claims/entry/refund history, configure a durable public receiver and observe an actual scheduled dispatch/recovery. Complete Safari/physical phone/blocked-third-party-cookie and operational security/load review before broad launch. No live charges, production revenue or real customer tickets should be created for these tests.

Continue through the runbook and record results honestly; there is no further implementation phase authorised implicitly by this report.

## Public follow-up

The separate sandbox and Partner Demo are now deployed. Actual hosted and mobile-widget Paystack TEST purchases, partner return, group claim/QR/entry, signed-in free checkout/history and durable manual notifications passed. See the current progress report for exact evidence and remaining automatic/cross-device/refund/recovery gates. Main production remains unchanged. Main source now also includes the standard-Web/default-export middleware fix, its two tests, and additive widget-limiter migration 202610160006; the widget fixture uses real SQL rate budgets. Final regression totals are main 325, sandbox 326 and Partner Demo 31. These updates supersede earlier deployment-blocker statements in this historical implementation report.
