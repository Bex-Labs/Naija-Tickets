import phase3 from '../../docs/integrations-phase3-openapi.json' with { type: 'json' };
import phase4 from '../../docs/integrations-phase4-openapi.json' with { type: 'json' };
import phase5 from '../../docs/integrations-phase5-openapi.json' with { type: 'json' };
import phase6 from '../../docs/integrations-phase6-openapi.json' with { type: 'json' };
import externalEvents from '../../docs/integrations-external-events-openapi.json' with { type: 'json' };
import { assemblePublicOpenApi, type OpenApiDocument } from './openapi.ts';
export const publicIntegrationSpec = assemblePublicOpenApi([
  { phase: 3, document: phase3 as OpenApiDocument },
  { phase: 4, document: phase4 as OpenApiDocument },
  { phase: 5, document: phase5 as OpenApiDocument },
  { phase: 6, document: phase6 as OpenApiDocument },
  { phase: 8, document: externalEvents as OpenApiDocument },
]);
