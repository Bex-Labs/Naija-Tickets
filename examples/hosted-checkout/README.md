# Hosted checkout examples

Use Node 24. These examples make secret API calls on the server and keep the most recent booking bound to this browser using a short-lived signed HttpOnly cookie. They are deliberately small, with no customer database or ticket duplication. A production partner should use its own persistent account/order ownership and idempotency storage.

1. Create/publish a fictional **Abuja TGIF — Sandbox** event, with ordinary/free and Group-of-5 ticket types, on the isolated sandbox.
2. Assign the event and register `http://localhost:3010` as a **Test** website origin in Developers & Integrations. Issue a Test key with `checkout:write` and `orders:read` (plus any catalogue permissions your own website needs).
3. Copy `.env.example` to a private local file and configure the exact sandbox URL, key, event UUID and a dedicated random cookie secret. Keep this file out of Git; do not use NEXT_PUBLIC_ names.
4. From this directory run `node --env-file=.env.local node.mjs`, then open `http://localhost:3010`. Buy Tickets redirects to the event’s focused hosted checkout. Selections are omitted so the customer chooses them there.
5. Complete only a marked **Paystack Test** payment. On the hosted confirmation use **Return to organiser**. This example independently queries the session and confirms only `paid`; forged return status parameters cannot fulfil an order.

For Next.js, copy `handler.mjs` into a server-only library, use `next-route.ts` as `app/api/tickets/checkout/route.ts` and fix the import. Set NT_PARTNER_ORIGIN to your application’s exact origin and register it on Naija Tickets. Visit `/api/tickets/checkout` to see the server-rendered button. The same endpoint handles the approved return. No browser API secret is required. In an existing product, call your backend from your own UI and retain its existing account/CSRF/order protections.

For **no-code HTML**, generate the event link in Hosted Checkout and copy:

```html
<a href="https://YOUR_NAIJA_HOST/checkout/link/YOUR_GENERATED_PUBLIC_LINK_ID"
  >Buy Tickets</a
>
```

The public link is not an API credential and can be published. The private checkout URL returned by the API must only go to its buyer; never log/cache/publish it. Register the return address before using either method. Use signed webhooks with durable deduplication for asynchronous fulfilment; do not rely on the buyer returning. See the platform developer guide for provider, webhook and deployment acceptance limitations.
