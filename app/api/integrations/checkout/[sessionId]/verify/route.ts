import { after } from 'next/server';
import { deliverOrderTickets } from '@/lib/ticket-delivery';
import { hostedCheckoutAction } from '@/lib/integrations/checkout-sessions.server';
const action = hostedCheckoutAction('verify', (orderId) =>
  after(deliverOrderTickets(orderId)),
);
async function handle(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  return action(request, sessionId);
}
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
