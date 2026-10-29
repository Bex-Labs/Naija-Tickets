export class IntegrationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter?: number,
  ) {
    super(message);
    this.name = 'IntegrationError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export function integrationDatabaseError(error: unknown): IntegrationError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : '';
  if (code === 'NT423')
    return new IntegrationError(
      423,
      'APPLICATION_SUSPENDED',
      'This application was suspended by the platform. Contact support for review.',
    );
  if (code === 'NT400')
    return new IntegrationError(
      400,
      'INVALID_REQUEST',
      'Check the checkout selection, promo code, registered return URLs and session configuration.',
    );
  if (code === 'NT409') {
    const reason =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : '';
    if (reason === 'Idempotency payload conflict.')
      return new IntegrationError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used for a different checkout request.',
      );
    return new IntegrationError(
      409,
      'CHECKOUT_CONFLICT',
      reason === 'Reservation payload conflict.'
        ? 'This booking is already reserved with different details. Refresh to resume payment.'
        : 'This checkout request conflicts with its existing booking or current ticket availability.',
    );
  }
  if (code === 'P0001') {
    const reason =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : '';
    if (reason === 'Promo code is not available for this event.')
      return new IntegrationError(
        409,
        'INVALID_PROMO_CODE',
        'Invalid Promo Code',
      );
    if (
      reason.startsWith('Promo code ') ||
      reason.startsWith('Only ') ||
      reason.includes('availability') ||
      reason.includes('sales')
    )
      return new IntegrationError(409, 'CHECKOUT_CONFLICT', reason);
  }
  if (code === 'NT410')
    return new IntegrationError(
      410,
      'CHECKOUT_EXPIRED',
      'This checkout link has expired. Start a new checkout or use your account or emailed ticket link.',
    );
  if (code === 'NT401')
    return new IntegrationError(
      401,
      'INVALID_API_KEY',
      'Provide a valid, active API key.',
    );
  if (code === 'NT403')
    return new IntegrationError(
      403,
      'INSUFFICIENT_SCOPE',
      'This API key does not have the required read permission.',
    );
  if (code === 'NT404')
    return new IntegrationError(404, 'NOT_FOUND', 'Event not found.');
  if (code === 'NT503')
    return new IntegrationError(
      503,
      'SANDBOX_NOT_CONFIGURED',
      'An isolated test event database is not configured. Test keys cannot read live events.',
    );
  if (code === '42501')
    return new IntegrationError(
      403,
      'FORBIDDEN',
      'Integration management permission is required for this organiser.',
    );
  if (code === 'P0002')
    return new IntegrationError(
      404,
      'NOT_FOUND',
      'Integration or API key not found.',
    );
  if (
    code === '42883' &&
    message.includes('change_organiser_integration_lifecycle')
  )
    return new IntegrationError(
      503,
      'INTEGRATION_REMOVAL_NOT_READY',
      'Website connection removal is not available until the platform database update is applied.',
    );
  if (
    code === '22023' &&
    message === 'Enable this integration before issuing keys.'
  )
    return new IntegrationError(
      409,
      'INTEGRATION_DISABLED',
      'Enable this integration before issuing keys.',
    );
  if (code === '22023' && message.includes('20 active keys maximum'))
    return new IntegrationError(
      409,
      'KEY_LIMIT_REACHED',
      'Revoke an unused key before creating another (20 active keys maximum).',
    );
  if (
    code === '22023' &&
    message === 'An organiser can register up to 10 integrations.'
  )
    return new IntegrationError(409, 'INTEGRATION_LIMIT_REACHED', message);
  if (code === '22023')
    return new IntegrationError(
      400,
      'INVALID_CONFIGURATION',
      'Check the integration configuration, allowed origins, expiry and active key limits.',
    );
  return new IntegrationError(
    503,
    'INTEGRATIONS_UNAVAILABLE',
    'Integrations are temporarily unavailable. Please try again.',
  );
}
