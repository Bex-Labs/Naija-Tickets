# Disable and remove integrations

Implemented locally on 18 October 2026 (Africa/Lagos). No remote migration or deployment was performed for this change.

In **Organiser workspace → Developers & Integrations**, select an application. The **Manage integration** section provides:

- **Disable integration**: pauses API authentication, new hosted checkout/payment starts, public links/widgets and outgoing notification dispatch. Configuration and unrevoked credentials are retained so **Enable integration** can resume the connection. Already revoked or expired credentials remain invalid.
- **Enable integration**: resumes the saved configuration, subject to current organiser permissions and platform suspension rules. It cannot override an administrator suspension.
- **Remove integration**: asks for confirmation, marks the application removed and disabled, revokes its remaining keys, disables links/widgets/webhook endpoints and hides it from the organiser application selector. Removal cannot be reversed through the dashboard; reconnect with a new integration.

Both actions preserve orders, issued tickets, group claims, sales attribution, refunds and payout history. A payment already authorised at the provider can still be verified and fulfilled safely. Removal does not refund a purchase or release its paid admissions. Admins retain the application and audit trail, labelled **Removed**. Disabled applications retain their saved settings; new notifications are not generated while disabled, and previously queued deliveries can resume after enabling. A request or delivery already in flight cannot be recalled.

## Implementation and access

- `POST /api/organiser/integrations/{id}/status` accepts exactly `{ "status": "disabled" }` or `{ "status": "active" }`.
- `DELETE /api/organiser/integrations/{id}` performs soft removal; repeated authorised removal succeeds without duplicate audit records.
- Existing configuration PATCH still supports active/disabled and cannot reactivate a removed application.
- Both new actions use existing organiser authentication, confirmed-email, same-origin and distributed rate-limit guards. The private transaction rechecks current integration-manager membership, locks configuration and writes an audit entry. API credentials cannot manage or remove applications.
- Service-only lifecycle RPC and existing RLS remain enforced. Removed applications do not consume the ten-current-application allowance. Keys, orders, financial records and customer profiles are not deleted.

## Required deployment

Apply `supabase/migrations/202610180001_integration_lifecycle.sql` **before deploying this source**. It depends on the existing integration migrations through `202610170002_hosted_report_efficiency.sql`; review the earlier pending rollout gates and linked project identity first. No new environment variables are required. Do not reset a database or apply the sandbox-only Partner Demo inbox migration to production.

## Verification

- Full regression suite: **349/349** passed, including **10 lifecycle checks** covering malformed status input, denied permissions/browser roles, pause/resume, administrator suspension, removal/revocation, safe payment completion/replay, group claims, private admin history and application limits.
- TypeScript, lint, Vercel-target build and whitespace checks passed.
- The actual organiser component was exercised in an isolated local browser preview with fictional, in-memory API responses: Disable, Enable, confirmation and removal-from-list passed. Child integration panels were stubbed for this focused UI review; it is not a public authenticated deployment acceptance test.

Remote deployment, remote database acceptance and physical-device testing remain unperformed for this change.
