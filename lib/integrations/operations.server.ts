import { integrationRpc } from './store.server.ts';
import { verifyIntegrationResourceBinding } from './resource-mode.server.ts';
import {
  requireAdvancedConfiguration,
  operationDatabaseError,
  type OperationsDependencies,
} from './operations.ts';
export const integrationOperationsDependencies: OperationsDependencies = {
  async requireConfiguration(context, entry) {
    requireAdvancedConfiguration(context, entry, process.env);
    await verifyIntegrationResourceBinding(context.environment);
  },
  read: (proof, operation, query) =>
    integrationRpc(
      'read_integration_operations',
      {
        p_key: proof.keyId,
        p_digest: proof.digest,
        p_mode: proof.environment,
        p_operation: operation,
        p_event: query.eventId,
        p_resource: query.resourceId,
        p_limit: query.limit,
        p_after: query.after,
      },
      operationDatabaseError,
    ),
  entry: (proof, input) =>
    integrationRpc(
      'perform_integration_entry',
      {
        p_key: proof.keyId,
        p_digest: proof.digest,
        p_mode: proof.environment,
        p_event: input.eventId,
        p_code: input.code,
        p_admit: input.admit,
        p_idempotency_digest: input.idempotencyDigest,
        p_payload_hash: input.payloadHash,
      },
      operationDatabaseError,
    ),
};
