import { publicIntegrationSpec } from '@/lib/integrations/public-spec';
export function GET() {
  return Response.json(publicIntegrationSpec, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
