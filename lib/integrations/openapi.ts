import { INTEGRATION_SCOPES } from './types.ts';
export type OpenApiDocument = {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, unknown>;
  components?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};
/** Namespace phase-local references so similarly named Error/Event DTOs cannot
 * silently overwrite one another when the public contract is assembled. */
export function assemblePublicOpenApi(
  sources: { phase: number; document: OpenApiDocument }[],
) {
  const paths: Record<string, unknown> = {},
    components: Record<string, Record<string, unknown>> = {
      schemas: {},
      securitySchemes: {},
    };
  let webhook: unknown;
  for (const { phase, document } of sources) {
    const prefix = 'Phase' + phase;
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== 'object') return value;
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (
          key === '$ref' &&
          typeof item === 'string' &&
          item.startsWith('#/components/')
        )
          result[key] = item.replace(
            /^#\/components\/([^/]+)\/(.+)$/,
            `#/components/$1/${prefix}$2`,
          );
        else if (key === 'security' && Array.isArray(item))
          result[key] = item.map((requirement) =>
            Object.fromEntries(
              Object.entries(requirement).map(([name, scopes]) => [
                prefix + name,
                scopes,
              ]),
            ),
          );
        else result[key] = visit(item);
      }
      return result;
    };
    for (const [kind, definitions] of Object.entries(
      document.components || {},
    )) {
      components[kind] ??= {};
      for (const [name, schema] of Object.entries(definitions))
        components[kind][prefix + name] = visit(schema);
    }
    for (const [path, definition] of Object.entries(document.paths)) {
      if (
        !path.startsWith('/api/v1/') &&
        !path.startsWith('/api/integrations/widgets/') &&
        !path.startsWith('/embed/') &&
        path !== '/integrations/widget-checkout'
      )
        continue;
      if (paths[path]) throw new Error('Duplicate public API path');
      const projected = visit(definition) as Record<string, unknown>;
      for (const method of ['get', 'post', 'options']) {
        const operation = projected[method] as
          | Record<string, unknown>
          | undefined;
        if (!operation) continue;
        operation.operationId =
          'phase' +
          phase +
          '_' +
          method +
          '_' +
          path.replace(/[^a-zA-Z0-9]+/g, '_');
        operation.tags = [
          path.includes('widget') || path.startsWith('/embed')
            ? 'Widgets'
            : path.includes('check-ins')
              ? 'Entry'
              : path.includes('checkout')
                ? 'Checkout'
                : path.includes('attendees')
                  ? 'Attendees'
                  : path.includes('refunds')
                    ? 'Refunds'
                    : path.includes('groups')
                      ? 'Groups'
                      : path.includes('orders')
                        ? 'Orders'
                        : path.includes('sales-summary')
                          ? 'Sales'
                          : path.includes('tickets')
                            ? 'Tickets'
                            : path.includes('events')
                              ? 'Events'
                              : 'Identity',
        ];
      }
      paths[path] = projected;
    }
    if (phase === 4 && document.components?.schemas?.WebhookEvent)
      webhook = {
        post: {
          summary: 'Receive a signed Naija Tickets event',
          description:
            'Configure the receiver in the organiser dashboard. Verify the exact raw body, ID and timestamp with the dedicated endpoint secret; durably deduplicate the event ID before acknowledging. At-least-once delivery; daily Hobby dispatch has no prompt-delivery guarantee.',
          security: [],
          parameters: [
            {
              name: 'naija-webhook-id',
              in: 'header',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'naija-webhook-timestamp',
              in: 'header',
              required: true,
              schema: { type: 'string', pattern: '^[0-9]{10}$' },
            },
            {
              name: 'naija-webhook-signature',
              in: 'header',
              required: true,
              schema: { type: 'string', pattern: '^v1=[a-f0-9]{64}$' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Phase4WebhookEvent' },
              },
            },
          },
          responses: {
            '200': {
              description:
                'Signature accepted and event durably recorded/deduplicated.',
            },
            '401': { description: 'Invalid signature or expired timestamp.' },
            '409': { description: 'Conflicting event identity/body.' },
            '503': {
              description: 'Durable inbox unavailable; do not acknowledge.',
            },
          },
        },
      };
  }
  let identity: unknown = paths['/api/v1/integration'];
  for (const key of [
    'get',
    'responses',
    '200',
    'content',
    'application/json',
    'schema',
    'properties',
    'data',
    'properties',
  ]) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity))
      throw new Error('Introspection schema missing');
    identity = (identity as Record<string, unknown>)[key];
  }
  const identityProperties = identity as Record<
    string,
    Record<string, unknown>
  >;
  (identityProperties.scopes.items as Record<string, unknown>).enum = [
    ...INTEGRATION_SCOPES,
  ];
  const capabilities = identityProperties.capabilities;
  const capabilityProperties = capabilities.properties as Record<
    string,
    unknown
  >;
  for (const name of ['advanced_operations', 'delegated_entry'])
    capabilityProperties[name] = {
      type: 'boolean',
      description:
        'Deployment configuration only; individual operations still require explicit scopes and current grants.',
    };
  capabilities.required = [
    ...(capabilities.required as string[]),
    'advanced_operations',
    'delegated_entry',
  ];
  const embed = paths['/embed/events/{eventId}'] as {
    get: { parameters: unknown[] };
  };
  for (const [name, values] of [
    ['appearance', ['light', 'dark']],
    ['accent', ['green', 'blue', 'violet']],
    ['button', ['rounded', 'square']],
  ])
    embed.get.parameters.push({
      name,
      in: 'query',
      required: false,
      schema: { type: 'string', enum: values },
      description: 'Validated optional snippet appearance; no arbitrary CSS.',
    });
  paths['/api/v1/openapi.json'] = {
    get: {
      operationId: 'downloadPublicOpenApi',
      tags: ['Documentation'],
      summary: 'Download this public contract; no API key required',
      security: [],
      responses: {
        '200': {
          description:
            'OpenAPI 3.1 JSON document. Public schema only; configuration and deployment acceptance are separate.',
        },
      },
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Naija Tickets Integration API',
      version: '1.7.0',
      description:
        'Implemented contract through Phase 7. Server secret keys stay on partner servers; public widgets use separate identifiers. Test operations require a separate database/deployment and Paystack test mode. Features fail closed until configured. Public sandbox purchase, receiver and scheduled-delivery acceptance must be recorded separately; this document is not proof of activation.',
    },
    servers: [
      {
        url: '/',
        description:
          'This deployment origin. Use the separately configured sandbox origin for test purchases; never assume main-site Test prefixes isolate business data.',
      },
    ],
    paths,
    components,
    ...(webhook ? { webhooks: { eventNotification: webhook } } : {}),
  };
}
