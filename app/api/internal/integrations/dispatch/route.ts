import { integrationRpc } from '@/lib/integrations/store.server';
import { integrationResourceMode } from '@/lib/integrations/resource-mode';
import { verifyIntegrationResourceBinding } from '@/lib/integrations/resource-mode.server';
import { webhookEncryption } from '@/lib/integrations/webhook-encryption';
import {
  dispatchWebhooks,
  schedulerAuthorized,
  type WebhookJob,
} from '@/lib/integrations/webhook-dispatch';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (
    !schedulerAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET,
    )
  )
    return Response.json({ error: 'Unauthorised.' }, { status: 401, headers });
  try {
    const mode = integrationResourceMode(process.env);
    await verifyIntegrationResourceBinding(mode);
    await integrationRpc('purge_hosted_prefill', {
      p_mode: mode,
      p_limit: 2000,
    });
    if (process.env.INTEGRATIONS_WEBHOOKS_ENABLED !== 'true')
      return Response.json({ enabled: false }, { status: 503, headers });
    const result = await dispatchWebhooks(
      {
        claim: () =>
          integrationRpc<WebhookJob[]>('claim_integration_webhooks', {
            p_mode: mode,
            p_limit: 5,
          }),
        authorize: (job) =>
          integrationRpc<boolean>('authorize_integration_webhook_send', {
            p_id: job.id,
            p_lease: job.leaseId,
          }),
        finish: (job, result, delay) =>
          integrationRpc('finish_integration_webhook', {
            p_id: job.id,
            p_lease: job.leaseId,
            p_http: result.http,
            p_outcome: result.outcome,
            p_delay: delay,
          }),
      },
      webhookEncryption(process.env),
    );
    return Response.json(result, { headers });
  } catch {
    // Do not log job payloads, endpoint URLs, encryption errors or credentials.
    return Response.json(
      { error: 'Webhook dispatch is temporarily unavailable.' },
      { status: 503, headers },
    );
  }
}
// Vercel Cron invokes GET; external authenticated schedulers can use POST.
export const GET = POST;
