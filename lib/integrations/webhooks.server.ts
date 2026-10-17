import { randomUUID } from 'node:crypto';
import { integrationRpc } from './store.server.ts';
import {
  integrationId,
  integrationEnvironment,
  readIntegrationJson,
} from './validation.ts';
import {
  webhookUrl,
  resolveWebhookDestination,
} from './webhook-destination.ts';
import {
  webhookEncryption,
  encryptWebhookSecret,
  newWebhookSecret,
} from './webhook-encryption.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import { WEBHOOK_EVENTS, type WebhookDashboard } from './webhook-types.ts';
import { IntegrationError } from './errors.ts';
export function listWebhooks(
  user: string,
  app: string,
  before: string | null = null,
) {
  return integrationRpc<WebhookDashboard>('list_integration_webhooks', {
    p_user: user,
    p_app: integrationId(app),
    p_before: before ? integrationId(before) : null,
  });
}
export async function createWebhook(
  request: Request,
  user: string,
  app: string,
) {
  app = integrationId(app);
  // Authorize before DNS or encryption work, so this is not a public DNS proxy.
  await listWebhooks(user, app);
  const input = (await readIntegrationJson(request)) as Record<string, unknown>;
  const mode = integrationEnvironment(input?.environment),
    url = webhookUrl(input?.url);
  const events = input?.events;
  if (
    !Array.isArray(events) ||
    !events.length ||
    events.length > WEBHOOK_EVENTS.length ||
    new Set(events).size !== events.length ||
    events.some((event) => !WEBHOOK_EVENTS.includes(event))
  )
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Choose supported webhook events without duplicates.',
    );
  await verifyIntegrationResourceBinding(mode);
  try {
    await resolveWebhookDestination(url);
  } catch {
    throw new IntegrationError(
      400,
      'INVALID_WEBHOOK_URL',
      'The webhook destination must resolve only to public internet addresses.',
    );
  }
  const id = randomUUID(),
    secret = newWebhookSecret();
  const encrypted = encryptWebhookSecret(
    secret,
    `${id}:${app}:${mode}`,
    webhookEncryption(process.env),
  );
  await integrationRpc('save_integration_webhook', {
    p_user: user,
    p_app: app,
    p_id: id,
    p_mode: mode,
    p_url: url.href,
    p_origin: url.origin,
    p_events: events,
    p_encrypted: encrypted,
  });
  return { id, secret };
}
export async function updateWebhook(
  request: Request,
  user: string,
  app: string,
  endpoint: string,
) {
  app = integrationId(app);
  endpoint = integrationId(endpoint);
  const state = await listWebhooks(user, app),
    existing = state.endpoints.find((item) => item.id === endpoint);
  if (!existing)
    throw new IntegrationError(404, 'NOT_FOUND', 'Webhook endpoint not found.');
  const input = (await readIntegrationJson(request)) as Record<string, unknown>;
  if (
    !input ||
    typeof input.enabled !== 'boolean' ||
    (input.rotate !== undefined && typeof input.rotate !== 'boolean')
  )
    throw new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Choose whether to enable or rotate this webhook.',
    );
  let secret: string | null = null,
    encrypted: string | null = null;
  if (input.rotate) {
    secret = newWebhookSecret();
    encrypted = encryptWebhookSecret(
      secret,
      `${endpoint}:${app}:${existing.environment}`,
      webhookEncryption(process.env),
    );
  }
  await integrationRpc('update_integration_webhook', {
    p_user: user,
    p_app: app,
    p_id: endpoint,
    p_enabled: input.enabled,
    p_encrypted: encrypted,
  });
  return { id: endpoint, secret };
}
