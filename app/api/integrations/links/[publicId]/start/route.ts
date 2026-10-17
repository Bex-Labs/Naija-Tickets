import { startHostedLink } from '@/lib/integrations/hosted-links.server';
import {
  IntegrationError,
  integrationDatabaseError,
} from '@/lib/integrations/errors';
async function handle(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
  try {
    return Response.json(
      {
        checkout_url: await startHostedLink(
          request,
          (await context.params).publicId,
        ),
      },
      { headers },
    );
  } catch (cause) {
    const error =
      cause instanceof IntegrationError
        ? cause
        : integrationDatabaseError(cause);
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  }
}
export const POST = handle;
export const GET = handle;
export const OPTIONS = handle;
