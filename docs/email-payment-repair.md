# Email and Test-payment repair — 25 October 2026

## Confirmed findings

- The main website is to continue using Paystack Test payments, as requested by the owner. This does not change its Supabase database or its integration resource binding.
- Failed ticket confirmations for verified payments recorded `Cannot read properties of undefined (reading 'parse')`. Rendering stopped before the request to Resend.
- `opentype.js` exposes its parser through the CommonJS default export in Node and a named ESM export in Vite. The previous renderer assumed a default export in both environments.
- The locally saved main Paystack Test key authenticates with Paystack. The deployed site reported `PAYMENT_PROVIDER_AUTH`; the existing production secret is unreadable, so its value cannot be compared with the local key.
- The deployed email status endpoint reports email configuration enabled. The locally configured Resend account accepts authenticated read requests; its earlier test messages were delivered. There are no verified sender domains. Sending from the Resend test sender to arbitrary customers is not ready; a verified sender domain is still required for general customer delivery.

## Prepared repair

`ticket-font-parser.ts` selects the named or default parser. `ticket-email-fonts.ts` uses it and clears a failed font-loading promise so a later request can retry. Existing outlined text, QR codes, payment verification, recipient selection and email idempotency remain in use.

The isolated deployment source is based on the currently deployed revision, `5db773c01dd6c235443918d7c20db5a5f1e81ca7`. Only the font renderer, its parser helper and regression tests differ. This avoids deploying later integration features whose main-database migrations are still pending. No database migration is part of this repair.

The prepared environment repair replaces only the main project's Production `PAYSTACK_SECRET_KEY` with the authenticated, locally saved Test key, retaining Secret storage. It requires a new deployment to take effect. No keys are recorded in this document or deployment source.

## Validation

- All 199 tests passed against the isolated production revision plus the fix.
- All 19 focused email tests passed after the final test-variable lint correction.
- TypeScript, focused lint and formatting checks passed using clean locked dependencies in the temporary folder. Local dependency reads in the Documents folder repeatedly stalled; the clean installation avoided those reads.
- The Vercel/Nitro production build passed with Node 24 and valid routing output.
- The compiled production font-renderer module successfully produced SVG glyph paths, including Nigerian currency and accented text. This directly exercises the export format that previously failed after bundling.
- Ticket artwork tests verify nonblank text and decode the issued QR content without requiring system fonts.
- A read-only check confirmed that one failed 14 October customer confirmation belongs to a verified payment and has the same renderer failure.

## Deployment and delivery status

Completed with the owner's explicit approval to deploy, retain Test payments, and resend one existing confirmation to the owner's test email.

- Replaced only the main Production Paystack secret with the authenticated local Test key, retaining Secret storage.
- Built and staged deployment `dpl_9gmYj2HJ3q9LGEHkhgtNnSPzymEe`; its home page returned HTTP 200 with the expected app content.
- Retried the explicitly authorised existing confirmation through the staged application's normal email endpoint. The endpoint returned HTTP 200 / `sent`; its delivery record has a provider message ID and cleared error.
- Resend independently reported `delivered` to the approved recipient. The recorded send time is 25 October 2026 at 11:25:37 UTC. This verifies provider delivery, not that the recipient has opened the email.
- Started one Test checkout through the staged application's normal reservation and Paystack initialization endpoints. Initialization returned HTTP 200 with a Paystack checkout URL and no provider-authentication error. No charge was completed. Released that test reservation and verified it expired.
- Promoted this exact verified deployment to `https://naija-tickets.vercel.app/`. A public check at 11:33 UTC confirmed HTTP 200 for the home page, email configuration enabled, and the retried receipt's status `sent`.

No database migrations or broader integration rollout were applied. Other failed customer confirmations were not replayed. General delivery to arbitrary customer addresses remains dependent on verifying a sender domain in Resend.

The later [page-loading repair](page-loading-repair.md) retains this email fix and supersedes the deployment with `dpl_2qrEN1Brt9jLAuTqUvNhJ2zrVzPy`.
