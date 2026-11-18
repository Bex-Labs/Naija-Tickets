import { IntegrationError } from './errors.ts';
import {
  integrationApiHandler,
  type IntegrationApiDependencies,
  type IntegrationAuthProof,
} from './api.ts';
import { readIntegrationJson } from './validation.ts';

export type ExternalEventDependencies = {
  upsert(
    proof: IntegrationAuthProof,
    externalId: string,
    payload: unknown,
  ): Promise<unknown>;
};
const invalid = (message: string): never => {
  throw new IntegrationError(400, 'INVALID_REQUEST', message);
};
function externalId(value: string | null): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) {
    return invalid(
      'Use an external event ID with letters, numbers, dots, underscores, colons or hyphens.',
    );
  }
  return value;
}
export function externalEventUpsertHandler(
  api: IntegrationApiDependencies,
  deps: ExternalEventDependencies,
  id: string,
) {
  return integrationApiHandler(
    api,
    'external_events:write',
    'external_events.upsert',
    async (_context, request, proof) => {
      if (new URL(request.url).search)
        invalid('External event creation accepts no query parameters.');
      const payload = await readIntegrationJson(request);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        invalid('Send an external event object.');
      return deps.upsert(proof, externalId(id), payload);
    },
    false,
    'PUT',
  );
}
