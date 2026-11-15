# Developer API checkout example

This is a working Buy Tickets button backed by a small Node server. Adding an API key to `.env` alone does not connect an existing website button. A static VS Code Live Server cannot read private environment variables or call the API securely on behalf of your website.

## Test it locally

1. In Naija Tickets → Developers & Integrations choose **Connect with the API**, **On my computer**, **Test a purchase**. Register `http://localhost:3010`, select an upcoming published event and **Save website settings**.
2. Generate a Test key with the recommended checkout permissions: `integration:read`, `events:read`, `tickets:read`, `availability:read`, `checkout:write`, `orders:read`.
3. In this folder copy `.env.example` to `.env.local`. Set `NT_API_KEY` privately. Set `NT_API_ORIGIN` to the Naija Tickets app you are running, normally `http://localhost:3000`. Never prefix the key with `VITE_` or `NEXT_PUBLIC_`.
4. Run `node node.mjs` using Node 24, then open `http://localhost:3010`. The server automatically loads `.env.local`. No packages, separate sandbox, manually generated cookie secret or event ID is needed for this local example.
5. Select an event and click **Buy Tickets**. The server creates a session and sends the browser to Naija Tickets checkout. Complete only a marked Paystack Test purchase.
6. Return to this website after payment. Its backend checks the session; a forged `nt_status=paid` cannot confirm a purchase.

Restart the starter after changing environment variables. `localhost` and `127.0.0.1` are different origins; use the exact saved hostname. A temporary cookie secret is generated for local Test runs; restarting invalidates the example's previous browser booking cookie. Use a dedicated persistent secret in production.

## Connect your existing website

Your own button must point to a backend route, not the secret key or the API home page. For example, after installing the Next.js route below:

```html
<a href="/api/tickets/checkout">Buy Tickets</a>
```

The route displays the protected checkout form; its POST creates a session through `/api/v1/checkout-sessions` and redirects to `checkout_url`. For your own frontend UX, implement that same server-side session call behind your existing button and keep its CSRF, account ownership and idempotency protections. Never call the secret API directly from browser JavaScript.

For Next.js, copy `handler.mjs` into a server-only library and adapt `next-route.ts` as `app/api/tickets/checkout/route.ts`. Set the environment variables on that Next.js backend. Set a dedicated `NT_EXAMPLE_COOKIE_SECRET` (at least 43 random characters) and register your exact website origin on Naija Tickets.

For other backend languages/frameworks, use the same HTTP endpoints: GET `/api/v1/events`, POST `/api/v1/checkout-sessions`, GET `/api/v1/checkout-sessions/{id}`. Use Test event/ticket IDs returned by the Test catalogue. Optional `NT_EVENT_ID` accepts an assigned event to skip the event chooser.

## Live deployment

Choose **On the internet → Accept real purchases**, register your HTTPS origin and generate a Live key. On your backend set NT_MODE=live, NT_API_KEY to that Live key, NT_API_ORIGIN to the deployed Naija Tickets address, NT_PARTNER_ORIGIN to your HTTPS website, and a dedicated persistent cookie secret. Naija Tickets must have Live payments enabled. This example must run as a server/serverless function; uploading `.env` beside static HTML cannot run its backend.

The private checkout URL returned by the API belongs only to its buyer. Do not log, cache or publish it. A production partner should replace the example's most-recent-booking cookie with persistent account/order ownership and idempotency storage. Use configured signed webhooks for asynchronous fulfilment; do not rely on the buyer returning.
