import { requireIntegrationResourceMode } from './resource-mode.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import { integrationRpc } from './store.server.ts';
import type { EventReadDependencies } from './events.ts';

export const integrationEventDependencies: EventReadDependencies = {
  read: async (proof, operation, eventId, query) => {
    requireIntegrationResourceMode(proof.environment, process.env);
    if (proof.environment === 'test')
      await verifyIntegrationResourceBinding(proof.environment);
    return integrationRpc('read_integration_events', {
      p_key_id: proof.keyId,
      p_digest: proof.digest,
      p_environment: proof.environment,
      p_operation: operation,
      p_event_id: eventId,
      p_limit: query.limit,
      p_city: query.city,
      p_category: query.category,
      p_starts_from: query.startsFrom,
      p_starts_before: query.startsBefore,
      p_after_id: query.afterId,
      p_after_start: query.afterStart,
      p_after_sort: query.afterSort,
    });
  },
};
