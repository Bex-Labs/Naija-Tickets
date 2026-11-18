# Organiser inactivity logout — 26 October 2026

## Behaviour

The organiser workspace locks and signs out its current Supabase browser session after 15 minutes without user interaction. A warning appears with 60 seconds remaining. **Stay signed in** renews the timer; **Sign out now** ends it immediately. The dialog warns about unsaved changes and initially focuses the continuation button.

Clicks, pointer movement, typing, scrolling and touch count as activity while the portal is visible. Repeated input is throttled. Token refresh, polling, focus and visibility changes do not renew the deadline. Focus/resume checks compare absolute timestamps so background timer throttling and laptop sleep cannot reset the idle period. Once the warning is open, an explicit continuation is required.

An activity record is shared across organiser tabs and survives reload/navigation. It stores a session identifier and activity time, never an access or refresh token. JWT refresh retains the same bookkeeping identity; a genuinely new login starts a new idle period. Expired records cannot be renewed by interacting with the old page. If browser storage is blocked, the open tab still enforces an in-memory deadline.

At expiry, protected workspace contents are unmounted before attempting sign-out. The existing Supabase client uses `signOut({ scope: 'local' })`, preserving sessions on other devices. Success redirects to `/login?next=/organiser&reason=inactivity`, with a clear sign-in notice. A failed sign-out request leaves the workspace locked and offers a retry.

This is browser inactivity logout, not a new backend session ledger. Existing server authentication/role checks remain authoritative. Supabase access JWTs retain their normal expiry semantics after sign-out; this change does not claim immediate revocation of copied access JWTs. See [Supabase sign-out](https://supabase.com/docs/reference/javascript/auth-signout). No paid Supabase session policy, new database migration or API-key revocation is included. Application API credentials continue independently of the organiser's portal session.

## Verification and status

- All 209 tests passed against the isolated production source plus this change, including ten inactivity/session tests.
- TypeScript, focused lint and formatting passed. The production build passed.
- Chrome fixture uses the real guard component with a simulated clock and fake authentication on its own localhost origin. Verified warning at 14 minutes, **Stay signed in** reopening the protected view, and expiry removing the protected view and redirecting to login with local-scope sign-out recorded. No real account was signed out in this fixture.
- Warning screenshot: `outputs/organiser-idle-20261026/warning-fixture.png`.
- Implemented in the main working source and prepared in the isolated hotfix source. On 26 October the owner explicitly chose **Keep it local for now**. The timeout has not been deployed; the main production website retains its previous session behaviour. A future deployment needs a new explicit instruction. No integration rollout is included.

## Register a new test application

1. Open [the sandbox organiser portal](https://naija-tickets-sandbox.vercel.app/organiser) and sign in with a sandbox organiser account. Accounts, events and keys are separate from the main platform.
2. Open **Developers & Integrations → New application**, select the organiser and enter a name, for example **My Website Test**.
3. In **Test website origins**, enter the partner website's origin, one per line. For the existing demo, use `https://naija-tickets-partner-demo.vercel.app`; for local testing, add `http://localhost:3001`. Use no page paths, wildcards or credentials. An online website belongs under Test origins when testing with Test keys. Live origins can remain empty during testing.
4. Select the sandbox events this application may use. Publish a sandbox event separately before testing public event reads or checkout. Save/register the application with its status active.
5. For an API integration, select **Test** under API credentials. Grant only needed permissions. A purchase demo normally needs integration details, event information, ticket types/prices, availability, checkout creation and its own order results. Generate the key, copy it once and store it only in the partner backend's environment. In Partner Demo, the corresponding server setting is `NAIJA_TEST_API_KEY`; `NAIJA_API_ORIGIN` points to the sandbox. Restart/redeploy the partner after changing its environment.
6. Alternatively, for a simple Buy Tickets button, create a Test **Hosted Checkout Link** for an assigned sandbox event and registered return origin. This option does not require an API secret in the partner site.

Do not replace an existing demo integration's credentials/settings inadvertently. A new application has a new identity; if outgoing webhooks are also required, configure that application's endpoint and matching receiver credentials explicitly.

**Events this application may access** is an allowlist. Selecting only Book Club permits access to that assigned event, subject to the API key's permissions, event publication/availability and Test/Live mode rules. Other organiser events remain inaccessible. Nothing is selected automatically. Selecting a draft does not publish it or make it publicly purchasable. Assigning an event is not permission to read all attendee contacts or issue refunds; those have their own access controls.
