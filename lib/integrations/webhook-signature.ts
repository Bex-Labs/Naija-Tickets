import { createHmac, timingSafeEqual } from 'node:crypto';

export function webhookSignature(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
) {
  return createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest('hex');
}
// Receivers must verify the raw bytes before parsing and durably deduplicate id.
export function verifyWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
) {
  if (
    !/^[0-9]{10}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(webhookSignature(secret, id, Number(timestamp), body), 'hex'),
  );
}
