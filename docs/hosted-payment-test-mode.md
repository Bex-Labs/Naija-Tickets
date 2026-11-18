# Paystack Test payments on the main hosted website

The owner explicitly requested Paystack Test payments on the existing main Vercel website on 6 November 2026, rather than using the separate sandbox.

`INTEGRATIONS_RESOURCE_MODE` binds integration events, applications and checkout sessions to their database. It is independent of the provider payment mode. The main site's existing resource binding remains `live`.

Set the server-only `HOSTED_CHECKOUT_PAYMENT_MODE=test` to explicitly use Paystack Test payments for hosted checkout on this deployment. The configured `PAYSTACK_SECRET_KEY` must start with `sk_test_`. When the setting is absent, the existing behavior remains: the payment key must match the integration resource environment. Invalid modes and mismatched/missing secrets fail closed. Test resources cannot use Live provider payments.

Hosted checkout and the organiser's link controls display a Test-payment notice. No real money is charged, but bookings and ticket inventory are recorded in this website's database. Existing provider verification, amount/currency checks, ticket issuance and idempotency remain in use. The payout synchronizer continues to skip real settlement synchronization while a Test provider key is configured.

Keep Paystack keys server-side. The `nt_live_` / `nt_test_` integration credentials still identify the event-data environment; they are not Paystack payment keys. A main-database integration remains Live even while Paystack payments are explicitly Test. Browser input cannot change the provider mode.

The staged source omits the unrelated organiser inactivity timeout and the new recurring integration dispatcher schedule. The existing working source retains those local changes. No database migrations are part of this payment-mode change.

## Verified deployment

- Public site: `https://naija-tickets.vercel.app`.
- Promoted deployment: `dpl_GSWJHXN5ZeHP9Kb1yy6ShniFveyd`.
- Staged release: 367 tests passed; TypeScript and Vercel/Nitro build passed.
- Production public Supabase settings were explicitly loaded at build time. Their presence in the client bundle and public-key authentication were checked. An earlier staged build missed those client settings; the prior public version was restored while the corrected build was prepared.
- The reusable no-code link opened the Book Club checkout on the public domain.
- One general-admission ticket plus the fee produced a simulated NGN 5,250 Paystack Test payment using fictional attendee details.
- Paystack's TEST screen and successful Test scenario were verified. The return reached the hosted checkout, which displayed `Payment verified` and `Your booking is confirmed` and rendered one issued ticket.
- No real charge was made. One Test booking remains recorded in the main database. This does not certify real-money settlement or email delivery.
- The temporary unreserved staged checkout was cancelled normally. No migration, sandbox data copy or new recurring dispatcher was performed. Existing Paystack and database credentials were retained.

Screenshot evidence, without the private ticket QR: `/Users/Abbas/.codex/visualizations/2026/11/05/01a1ac44-6adb-7fd1-8fbb-b02385c50dae/naija-vercel-test-payment-confirmed.jpg`.
