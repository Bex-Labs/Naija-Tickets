export type PromoCode = {
  id: string;
  event_id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  starts_at: string;
  ends_at: string;
  usage_limit: number;
  ticket_type_ids: string[];
  active: boolean;
};

export const promoCodePattern = /^[A-Z0-9_-]{3,32}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePromoCodeInput(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const code =
    typeof value.code === 'string' ? value.code.trim().toUpperCase() : '';
  const amount =
    typeof value.discountValue === 'string' ? value.discountValue.trim() : '';
  const discountValue = Math.round(Number(amount) * 100);
  const startsAt = typeof value.startsAt === 'string' ? value.startsAt : '';
  const endsAt = typeof value.endsAt === 'string' ? value.endsAt : '';
  const hasTimezone = (date: string) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date);
  if (
    typeof value.eventId !== 'string' ||
    !uuidPattern.test(value.eventId) ||
    !promoCodePattern.test(code) ||
    !['percentage', 'fixed'].includes(String(value.discountType)) ||
    !/^\d+(\.\d{1,2})?$/.test(amount) ||
    !Number.isSafeInteger(discountValue) ||
    discountValue <= 0 ||
    discountValue > (value.discountType === 'percentage' ? 10000 : 100000000) ||
    !hasTimezone(startsAt) ||
    !hasTimezone(endsAt) ||
    !Number.isFinite(Date.parse(startsAt)) ||
    !Number.isFinite(Date.parse(endsAt)) ||
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    !Number.isSafeInteger(value.usageLimit) ||
    Number(value.usageLimit) < 1 ||
    Number(value.usageLimit) > 1000000 ||
    !Array.isArray(value.ticketTypeIds) ||
    value.ticketTypeIds.length > 100 ||
    !value.ticketTypeIds.every(
      (id) => typeof id === 'string' && uuidPattern.test(id),
    )
  )
    return null;
  return {
    eventId: value.eventId,
    code,
    discountType: value.discountType as PromoCode['discount_type'],
    discountValue,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    usageLimit: Number(value.usageLimit),
    ticketTypeIds: [...new Set(value.ticketTypeIds as string[])],
  };
}
