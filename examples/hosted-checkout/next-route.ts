// Copy handler.mjs to your server-only library and adjust this import.
// Example path: app/api/tickets/checkout/route.ts
import { handleHostedExample } from './handler.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) =>
  handleHostedExample(request, {
    ...process.env,
    NT_EXAMPLE_PATH: '/api/tickets/checkout',
  });
export const POST = GET;
