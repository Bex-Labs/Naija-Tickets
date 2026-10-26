export const PAYMENT_EMAIL_ERROR =
  'Enter a valid email address for payment, such as name@gmail.com. Test addresses ending in .test cannot be used for payment.';

export function isPaymentEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length > 254) return false;
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return !/(?:^|\.)(?:test|invalid|example|localhost)$/i.test(domain);
}
