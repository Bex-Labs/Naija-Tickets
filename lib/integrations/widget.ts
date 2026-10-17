import { IntegrationError, integrationDatabaseError } from './errors.ts';
import { integrationId, canonicalIntegrationOrigin } from './validation.ts';
import {
  checkoutReturnUrl,
  parseCheckoutIntent,
  type StoredCheckoutSession,
} from './checkout-sessions.ts';
import { projectIntegrationEvent, projectIntegrationTicket } from './events.ts';
import {
  hostedSecretDigest,
  hostedSessionSecret,
  type CheckoutSigningKeys,
  type HostedSessionIdentity,
} from './checkout-access.ts';
import {
  enforceIntegrationLimit,
  type IntegrationApiDependencies,
} from './api.ts';
import { WIDGET_ID_PATTERN, type WidgetSelection } from './widget-types.ts';
import { verifyWidgetProof } from './widget-proof.ts';
export type WidgetSnapshot = {
  actor: {
    integrationId: string;
    organiserId: string;
    widgetConfigId: string;
    revision: number;
    checkoutEnabled: boolean;
  };
  event: unknown;
  tickets: { ticket: unknown; max_packages: number }[];
};
export type WidgetDependencies = {
  api: Pick<IntegrationApiDependencies, 'limit' | 'trustedIp' | 'log'>;
  requireConfiguration(mode: 'test' | 'live', checkout: boolean): Promise<void>;
  signingKeys(): CheckoutSigningKeys;
  origin(request: Request): string;
  read(selection: WidgetSelection): Promise<WidgetSnapshot>;
  create(
    selection: WidgetSelection,
    input: {
      session: HostedSessionIdentity;
      intent: ReturnType<typeof parseCheckoutIntent>;
      revision: number;
      idempotencyDigest: string;
      payloadHash: string;
      accessHash: string;
      reservationHash: string;
    },
  ): Promise<StoredCheckoutSession>;
};
export function parseWidgetSelection(url: URL, event: string): WidgetSelection {
  if (
    [...url.searchParams.keys()].some(
      (key) =>
        ![
          'widget',
          'environment',
          'parent_origin',
          'return_url',
          'channel',
          'appearance',
          'accent',
          'button',
        ].includes(key),
    ) ||
    [...new Set(url.searchParams.keys())].some(
      (key) => url.searchParams.getAll(key).length !== 1,
    )
  )
    throw new IntegrationError(
      400,
      'INVALID_WIDGET',
      'Use the generated widget snippet.',
    );
  const widgetId = url.searchParams.get('widget') || '',
    mode = url.searchParams.get('environment');
  if (
    !WIDGET_ID_PATTERN.test(widgetId) ||
    !['test', 'live'].includes(mode || '')
  )
    throw new IntegrationError(404, 'NOT_FOUND', 'Ticket widget unavailable.');
  const environment = mode as 'test' | 'live';
  const parentOrigin = canonicalIntegrationOrigin(
    url.searchParams.get('parent_origin'),
    environment,
  );
  const returnUrl = checkoutReturnUrl(
    url.searchParams.get('return_url') || parentOrigin + '/',
    { environment },
  );
  if (new URL(returnUrl).origin !== parentOrigin)
    throw new IntegrationError(
      400,
      'INVALID_WIDGET',
      'Return to the registered embedding website.',
    );
  const channel = url.searchParams.get('channel') || '';
  if (!/^[a-f0-9]{32}$/.test(channel))
    throw new IntegrationError(
      400,
      'INVALID_WIDGET',
      'Use the generated widget snippet.',
    );
  const theme: Pick<WidgetSelection, 'appearance' | 'accent' | 'button'> = {};
  for (const [name, allowed] of [
    ['appearance', ['light', 'dark']],
    ['accent', ['green', 'blue', 'violet']],
    ['button', ['rounded', 'square']],
  ] as const) {
    const value = url.searchParams.get(name);
    if (value !== null) {
      if (!(allowed as readonly string[]).includes(value))
        throw new IntegrationError(
          400,
          'INVALID_WIDGET',
          'Choose supported widget appearance options.',
        );
      Object.assign(theme, { [name]: value });
    }
  }
  return {
    ...theme,
    widgetId,
    eventId: integrationId(event),
    environment,
    parentOrigin,
    returnUrl,
    channel,
  };
}
export async function widgetBudget(
  deps: WidgetDependencies,
  request: Request,
  snapshot?: WidgetSnapshot,
  create = false,
) {
  if (!snapshot) {
    await enforceIntegrationLimit(deps.api, 'widget:global', 600);
    const ip = deps.api.trustedIp?.(request);
    if (ip)
      await enforceIntegrationLimit(
        deps.api,
        `widget:ip:${await hostedSecretDigest(ip)}`,
        60,
      );
  } else {
    await enforceIntegrationLimit(
      deps.api,
      `widget:${create ? 'create' : 'read'}:${snapshot.actor.integrationId}`,
      create ? 10 : 120,
    );
    await enforceIntegrationLimit(
      deps.api,
      `widget:${create ? 'create' : 'read'}:org:${snapshot.actor.organiserId}`,
      create ? 30 : 300,
    );
  }
}
export function projectWidgetSnapshot(
  snapshot: WidgetSnapshot,
  selection: WidgetSelection,
) {
  if (
    !snapshot?.actor ||
    typeof snapshot.actor.checkoutEnabled !== 'boolean' ||
    !Number.isSafeInteger(snapshot.actor.revision) ||
    !Array.isArray(snapshot.tickets) ||
    snapshot.tickets.length > 100
  )
    throw new IntegrationError(
      503,
      'WIDGET_UNAVAILABLE',
      'Ticket selection is temporarily unavailable.',
    );
  return {
    widget_id: selection.widgetId,
    environment: selection.environment,
    checkout_enabled: snapshot.actor.checkoutEnabled,
    event: projectIntegrationEvent(snapshot.event),
    tickets: snapshot.tickets.map((item) => {
      if (!Number.isSafeInteger(item.max_packages) || item.max_packages < 0)
        throw new IntegrationError(
          503,
          'WIDGET_UNAVAILABLE',
          'Ticket quantities are temporarily unavailable.',
        );
      return {
        ...projectIntegrationTicket(item.ticket),
        max_packages_available: Math.min(20, item.max_packages),
      };
    }),
  };
}
export type PublicWidgetSnapshot = ReturnType<typeof projectWidgetSnapshot>;
export async function readWidget(
  deps: WidgetDependencies,
  request: Request,
  selection: WidgetSelection,
) {
  await deps.requireConfiguration(selection.environment, false);
  const snapshot = await deps.read(selection);
  await widgetBudget(deps, request, snapshot);
  return { snapshot, data: projectWidgetSnapshot(snapshot, selection) };
}
async function widgetForm(request: Request) {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/x-www-form-urlencoded')
  )
    throw new IntegrationError(
      415,
      'INVALID_FORM',
      'Use the ticket widget to continue.',
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new IntegrationError(400, 'INVALID_FORM', 'Choose tickets.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 5000);
    });
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 16384)
        throw new IntegrationError(
          413,
          'INVALID_FORM',
          'The ticket selection is too large.',
        );
      chunks.push(value);
    }
    const form = new URLSearchParams(
      new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (
      [...form.keys()].length > 102 ||
      [...form.keys()].some(
        (name) =>
          form.getAll(name).length !== 1 ||
          (name !== 'proof' &&
            name !== 'promo_code' &&
            !/^quantity_[a-f0-9-]{36}$/.test(name)),
      )
    )
      throw new IntegrationError(
        400,
        'INVALID_FORM',
        'Use only ticket quantities and a promo code.',
      );
    return form;
  } catch (cause) {
    if (cause instanceof IntegrationError) throw cause;
    throw new IntegrationError(
      400,
      'INVALID_FORM',
      'The ticket selection could not be read. Refresh the widget and try again.',
    );
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
export async function widgetCheckout(
  deps: WidgetDependencies,
  request: Request,
) {
  if (request.method !== 'POST')
    throw new IntegrationError(
      405,
      'METHOD_NOT_ALLOWED',
      'Use the ticket selection form.',
    );
  if (
    request.headers.has('authorization') ||
    request.headers.get('origin') !== deps.origin(request) ||
    (request.headers.has('sec-fetch-dest') &&
      request.headers.get('sec-fetch-dest') !== 'document')
  )
    throw new IntegrationError(
      403,
      'INVALID_ORIGIN',
      'Continue using the Naija Tickets widget.',
    );
  await widgetBudget(deps, request);
  const form = await widgetForm(request),
    signing = deps.signingKeys();
  const proof = verifyWidgetProof(form.get('proof') || '', signing);
  const url = new URL('/embed/events/' + proof.eventId, deps.origin(request));
  for (const [name, value] of Object.entries({
    widget: proof.widgetId,
    environment: proof.environment,
    parent_origin: proof.parentOrigin,
    return_url: proof.returnUrl,
    channel: proof.channel,
  }))
    url.searchParams.set(name, String(value));
  const selection = parseWidgetSelection(url, proof.eventId);
  await deps.requireConfiguration(selection.environment, true);
  const { snapshot } = await readWidget(deps, request, selection);
  if (
    !snapshot.actor.checkoutEnabled ||
    snapshot.actor.revision !== proof.revision ||
    snapshot.actor.widgetConfigId !== proof.configurationId
  )
    throw new IntegrationError(
      409,
      'WIDGET_CHANGED',
      'This widget has changed. Refresh it before continuing.',
    );
  await widgetBudget(deps, request, snapshot, true);
  const items = [...form.entries()]
    .filter(([name, value]) => name.startsWith('quantity_') && value !== '0')
    .map(([name, value]) => {
      if (!/^[1-9][0-9]?$/.test(value))
        throw new IntegrationError(
          400,
          'INVALID_FORM',
          'Choose whole ticket quantities.',
        );
      return {
        ticket_type_id: integrationId(name.slice(9)),
        quantity: Number(value),
      };
    });
  const intent = parseCheckoutIntent(
    {
      event_id: selection.eventId,
      items,
      promo_code: form.get('promo_code') || '',
      return_url: selection.returnUrl,
      cancel_url: selection.returnUrl,
    },
    { environment: selection.environment },
  );
  for (const item of intent.items)
    if (
      !snapshot.tickets.some((tier) => {
        const ticket = projectIntegrationTicket(tier.ticket);
        return (
          ticket.id === item.ticket_type_id &&
          ticket.sale_status === 'open' &&
          item.quantity <= tier.max_packages
        );
      })
    )
      throw new IntegrationError(
        409,
        'TICKETS_UNAVAILABLE',
        'That ticket quantity is no longer available. Refresh the selection.',
      );
  const session: HostedSessionIdentity = {
    id: crypto.randomUUID(),
    environment: selection.environment,
    expires_at: new Date(Date.now() + 1800000).toISOString(),
    signing_key_version: signing.activeVersion,
  };
  const stored = await deps.create(selection, {
    session,
    intent,
    revision: proof.revision,
    idempotencyDigest: await hostedSecretDigest(
      JSON.stringify(['widget', proof.configurationId, proof.nonce]),
    ),
    payloadHash: await hostedSecretDigest(JSON.stringify(intent)),
    accessHash: await hostedSecretDigest(
      await hostedSessionSecret(session, 'access', signing),
    ),
    reservationHash: await hostedSecretDigest(
      await hostedSessionSecret(session, 'reservation', signing),
    ),
  });
  const access = await hostedSessionSecret(stored, 'access', signing);
  if ((await hostedSecretDigest(access)) !== stored.capability_hash)
    throw new IntegrationError(
      503,
      'WIDGET_UNAVAILABLE',
      'Checkout signing is temporarily unavailable.',
    );
  const target = new URL(
    '/integrations/checkout/' + stored.id,
    deps.origin(request),
  );
  target.searchParams.set('access', access);
  return target;
}
export function widgetFailure(cause: unknown) {
  return cause instanceof IntegrationError
    ? cause
    : integrationDatabaseError(cause);
}
export function widgetRoute(
  deps: WidgetDependencies,
  route: string,
  handler: (request: Request) => Promise<Response>,
) {
  return async (request: Request) => {
    const requestId = crypto.randomUUID(),
      started = performance.now();
    const response = await handler(request);
    response.headers.set('X-Request-ID', requestId);
    deps.api.log?.({
      request_id: requestId,
      route,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    });
    return response;
  };
}
