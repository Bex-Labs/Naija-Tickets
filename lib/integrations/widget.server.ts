import { getTrustedAppOrigin } from '@/lib/paystack';
import { checkoutSigningKeys } from './checkout-sessions.server.ts';
import { integrationApiDependencies, integrationRpc } from './store.server.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import { requireHostedCheckoutConfiguration } from './resource-mode.ts';
import { IntegrationError } from './errors.ts';
import type { WidgetDependencies } from './widget.ts';
export const widgetDependencies: WidgetDependencies = {
  api: integrationApiDependencies,
  origin: (request) => getTrustedAppOrigin(request.url),
  signingKeys: checkoutSigningKeys,
  async requireConfiguration(mode, checkout) {
    if (process.env.INTEGRATIONS_WIDGETS_ENABLED !== 'true')
      throw new IntegrationError(
        503,
        'WIDGET_UNAVAILABLE',
        'Ticket widgets have not been enabled on this deployment.',
      );
    await verifyIntegrationResourceBinding(mode);
    if (checkout) requireHostedCheckoutConfiguration(mode, process.env);
  },
  read: (selection) =>
    integrationRpc('read_integration_widget', {
      p_widget: selection.widgetId,
      p_mode: selection.environment,
      p_origin: selection.parentOrigin,
      p_event: selection.eventId,
    }),
  create: (selection, input) =>
    integrationRpc('create_scoped_integration_session', {
      p_key_id: null,
      p_digest: null,
      p_environment: selection.environment,
      p_session_id: input.session.id,
      p_event_id: selection.eventId,
      p_items: input.intent.items,
      p_promo_code: input.intent.promo_code,
      p_return_url: input.intent.return_url,
      p_cancel_url: input.intent.cancel_url,
      p_idempotency_digest: input.idempotencyDigest,
      p_payload_hash: input.payloadHash,
      p_capability_hash: input.accessHash,
      p_reservation_hash: input.reservationHash,
      p_signing_version: input.session.signing_key_version,
      p_expires_at: input.session.expires_at,
      p_widget_id: selection.widgetId,
      p_parent_origin: selection.parentOrigin,
      p_widget_revision: input.revision,
    }),
};
