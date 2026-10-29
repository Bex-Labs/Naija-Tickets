import { integrationRpc } from './store.server.ts';
import type { ExternalEventDependencies } from './external-events.ts';
import { requireIntegrationResourceMode } from './resource-mode.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
export const externalEventDependencies: ExternalEventDependencies = {
  upsert: async (proof, externalId, payload) => {
    requireIntegrationResourceMode(proof.environment, process.env);
    await verifyIntegrationResourceBinding(proof.environment);
    return integrationRpc('upsert_integration_external_event', {
      p_key_id: proof.keyId,
      p_digest: proof.digest,
      p_environment: proof.environment,
      p_external_id: externalId,
      p_payload: payload,
    });
  },
};
