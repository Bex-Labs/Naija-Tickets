import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { IntegrationError } from './errors.ts';
export type WebhookEncryption = {
  active: string;
  keys: Record<string, string>;
};
const unavailable = () =>
  new IntegrationError(
    503,
    'WEBHOOKS_NOT_CONFIGURED',
    'Webhook signing encryption is not configured.',
  );
export function webhookEncryption(
  env: Record<string, string | undefined>,
): WebhookEncryption {
  try {
    const active = env.INTEGRATIONS_WEBHOOK_ENCRYPTION_VERSION || 'v1';
    const keys = JSON.parse(
      env.INTEGRATIONS_WEBHOOK_ENCRYPTION_KEYS || '{}',
    ) as Record<string, string>;
    if (
      !keys ||
      Array.isArray(keys) ||
      Object.keys(keys).length > 3 ||
      !Object.hasOwn(keys, active) ||
      Object.entries(keys).some(
        ([version, value]) =>
          !/^[A-Za-z0-9_-]{1,32}$/.test(version) ||
          typeof value !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(value) ||
          Buffer.from(value, 'base64url').length !== 32 ||
          Buffer.from(value, 'base64url').toString('base64url') !== value ||
          [
            'INTEGRATIONS_SIGNING_SECRET',
            'PAYSTACK_SECRET_KEY',
            'SUPABASE_SERVICE_ROLE_KEY',
            'ADMIN_SESSION_SECRET',
            'CRON_SECRET',
          ].some((name) => value === env[name]),
      )
    )
      throw unavailable();
    return { active, keys };
  } catch {
    throw unavailable();
  }
}
export const newWebhookSecret = () =>
  `whsec_${randomBytes(32).toString('base64url')}`;
export function encryptWebhookSecret(
  secret: string,
  context: string,
  config: WebhookEncryption,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(config.keys[config.active], 'base64url'),
    iv,
  );
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [
    config.active,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}
export function decryptWebhookSecret(
  value: string,
  context: string,
  config: WebhookEncryption,
) {
  try {
    const [version, iv, encrypted, tag, extra] = value.split('.');
    if (
      extra ||
      !Object.hasOwn(config.keys, version) ||
      !/^[A-Za-z0-9_-]{16}$/.test(iv || '') ||
      !/^[A-Za-z0-9_-]{66}$/.test(encrypted || '') ||
      !/^[A-Za-z0-9_-]{22}$/.test(tag || '') ||
      [iv, encrypted, tag].some(
        (part) => Buffer.from(part, 'base64url').toString('base64url') !== part,
      )
    )
      throw unavailable();
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(config.keys[version], 'base64url'),
      Buffer.from(iv, 'base64url'),
      { authTagLength: 16 },
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const secret = Buffer.concat([
      cipher.update(Buffer.from(encrypted, 'base64url')),
      cipher.final(),
    ]).toString('utf8');
    if (!/^whsec_[A-Za-z0-9_-]{43}$/.test(secret)) throw unavailable();
    return secret;
  } catch {
    throw unavailable();
  }
}
