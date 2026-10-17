# Secure checkout popup

The partner keeps its own event page. Its server creates the existing checkout session; the browser opens a checkout-only modal. The same reservation, Paystack verification, ticket issuance, group claims and outgoing outbox remain authoritative. No database migration or new scope is required.

## Platform configuration

`INTEGRATIONS_POPUP_ENABLED=true` opts in on a configured hosted-checkout deployment. The default is false. Register the partner's exact Test/Live website origin and assign its event as before. This flag is separate from public ticket-selection widgets, which retain their existing top-level handoff.

A successful `POST /api/v1/checkout-sessions` additionally returns `data.popup_url` while retaining `data.checkout_url`. Both are private capabilities, not public catalogue links. Do not cache, log, persist or publish either URL. The popup URL expires with its session, at most thirty minutes. Its signed permit binds one session, environment, expiry, signing version and the registered `return_url` origin. The access secret is in the fragment; the frame removes it from its address after reading it into memory.

## Partner integration

Keep the API key on your server. Use the existing stable purchase intent/idempotency key, server-owned return URL and browser-owned booking/session protections. Send only the private `popup_url` to that buyer's browser.

```html
<script src="https://YOUR_NAIJA_HOST/integrations/checkout-v1.js" defer></script>
```

```js
// Called after your own server has created the session for this browser.
NaijaTicketsCheckout.open({
  popupUrl: result.popup_url,
  onComplete: ({ sessionId }) => verifyBookingOnYourServer(sessionId),
  onClose: () => showResumeButton(),
});
```

`verifyBookingOnYourServer` is your application function, not a provided browser API. It must check that the booking belongs to this browser/account, query `GET /api/v1/checkout-sessions/:id` using your server key with `orders:read`, and confirm only a `paid` result. Never fulfil from browser callbacks or return parameters. No attendee contacts, QR codes, order references or group links are posted to the parent.

Allow the **exact Naija deployment origin** in your CSP's `script-src`, `style-src` and `frame-src`. Avoid wildcards. The script must be loaded using a normal script tag (or `document.createElement('script')`); it determines the trusted platform origin from its own script URL. The SDK uses a native dialog, focuses the close button, restores focus and scroll on close, supports Escape and honours reduced motion. Closing it does not refund or instantly release a reservation. Reopen the same unexpired purchase intent to resume; normal reservation expiry still applies. After a confirmed purchase, start a new purchase intent for another booking.

## Payment and tickets

Buyer/attendee details stay in the trusted Naija frame. It requires no login or third-party cookie. The frame resumes the existing server-initialised Paystack transaction using official InlineJS v2; card/bank details stay with the provider. The server verifies the stored provider reference, amount, currency and Test/Live domain before invoking the existing atomic finalisation. A success message from JavaScript alone cannot issue tickets. Duplicate callbacks retain the existing issuance protections. Free bookings use the existing free-booking finalisation.

The frame shows a verified confirmation, an optional private ticket/group-link page in a new tab, and **Return to website**. Returning closes the modal; Partner Demo then independently checks the booking on its server and shows its own confirmation. Some bank/3-D Secure authentication may need a provider-controlled window. Provider availability and supported browsers still apply; do not promise every payment channel works inside every embedded browser. Explicit `checkout_url` redirect integrations remain backward compatible.

Reference: [Paystack InlineJS](https://paystack.com/docs/developer-tools/inlinejs/). The served v2 library's `resumeTransaction(accessCode, {onSuccess, onCancel, onError})` interface was inspected before implementation.

## Acceptance checks

- Valid registered origin can frame; missing, forged, expired and disabled permits fail closed with DENY.
- Rechecking the private capability also rechecks the original checkout's current issuer/event grants and current registered origin.
- The browser cannot supply a payment reference to verification; only the stored order's latest Paystack attempt is verified.
- A pending, mismatched, failed or expired payment cannot issue usable tickets.
- Parent messages require exact source window, platform origin, session and permit channel; the partner still verifies server-side.
- Ordinary and group selections, free booking, duplicate verification, close/resume, keyboard and 390px layout should be exercised on the public sandbox.
- Keep outstanding automatic cron, physical-device/Safari/blocked-cookie and provider refund/recovery gates visible; popup tests do not satisfy them automatically.
