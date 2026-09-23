export type CustomerProfileInput = {
  fullName: string;
  phone: string;
};

type ParseResult =
  | { value: CustomerProfileInput; error?: never }
  | { value?: never; error: string };

export function parseCustomerProfileInput(value: unknown): ParseResult {
  if (!value || typeof value !== 'object') {
    return { error: 'Check your profile details and try again.' };
  }
  const body = value as Record<string, unknown>;
  const fullName =
    typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (fullName.length < 2 || fullName.length > 120) {
    return { error: 'Enter a full name between 2 and 120 characters.' };
  }
  if (phone.length < 7 || phone.length > 40) {
    return { error: 'Enter a phone number between 7 and 40 characters.' };
  }
  return { value: { fullName, phone } };
}
