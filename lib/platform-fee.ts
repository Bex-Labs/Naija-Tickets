export type PlatformFeeRule =
  | { type: 'percentage'; basisPoints: number }
  | { type: 'fixed'; fixedKoboPerTicket: number };

export const DEFAULT_PLATFORM_FEE_RULE: PlatformFeeRule = {
  type: 'percentage',
  basisPoints: 500,
};

export const MAX_PLATFORM_FEE_BASIS_POINTS = 2500;
export const MAX_FIXED_FEE_KOBO_PER_TICKET = 10_000_000;

function decimalInput(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (
    typeof value !== 'string' ||
    !/^\d{1,6}(?:\.\d{1,2})?$/.test(value.trim())
  ) {
    return null;
  }
  return Number(value);
}

export function platformFeeRuleFromAdminInput(
  values: Record<string, unknown>,
): PlatformFeeRule | null {
  if (values.type === 'percentage') {
    const percentage = decimalInput(values.percentage);
    const basisPoints = Math.round((percentage ?? -1) * 100);
    if (
      percentage !== null &&
      Math.abs(percentage * 100 - basisPoints) < 0.00001 &&
      basisPoints >= 0 &&
      basisPoints <= MAX_PLATFORM_FEE_BASIS_POINTS
    ) {
      return { type: 'percentage', basisPoints };
    }
  }
  if (values.type === 'fixed') {
    const fixedNairaPerTicket = decimalInput(values.fixedNairaPerTicket);
    const fixedKoboPerTicket = Math.round((fixedNairaPerTicket ?? -1) * 100);
    if (
      fixedNairaPerTicket !== null &&
      Math.abs(fixedNairaPerTicket * 100 - fixedKoboPerTicket) < 0.00001 &&
      fixedKoboPerTicket >= 0 &&
      fixedKoboPerTicket <= MAX_FIXED_FEE_KOBO_PER_TICKET
    ) {
      return { type: 'fixed', fixedKoboPerTicket };
    }
  }
  return null;
}

export function parsePlatformFeeRule(value: unknown): PlatformFeeRule {
  if (!value || typeof value !== 'object') return DEFAULT_PLATFORM_FEE_RULE;
  const rule = value as Record<string, unknown>;
  if (
    rule.type === 'fixed' &&
    typeof rule.fixed_kobo_per_ticket === 'number' &&
    Number.isSafeInteger(rule.fixed_kobo_per_ticket) &&
    rule.fixed_kobo_per_ticket >= 0 &&
    rule.fixed_kobo_per_ticket <= MAX_FIXED_FEE_KOBO_PER_TICKET
  ) {
    return { type: 'fixed', fixedKoboPerTicket: rule.fixed_kobo_per_ticket };
  }

  const basisPoints =
    typeof rule.basis_points === 'number' &&
    Number.isSafeInteger(rule.basis_points)
      ? rule.basis_points
      : typeof rule.percentage === 'number' &&
          Number.isSafeInteger(Math.round(rule.percentage * 100)) &&
          Math.abs(rule.percentage * 100 - Math.round(rule.percentage * 100)) <
            0.00001
        ? Math.round(rule.percentage * 100)
        : null;
  if (
    basisPoints !== null &&
    basisPoints >= 0 &&
    basisPoints <= MAX_PLATFORM_FEE_BASIS_POINTS
  ) {
    return { type: 'percentage', basisPoints };
  }
  return DEFAULT_PLATFORM_FEE_RULE;
}

export function platformFeeStorageValue(rule: PlatformFeeRule) {
  return rule.type === 'percentage'
    ? { type: 'percentage', basis_points: rule.basisPoints }
    : { type: 'fixed', fixed_kobo_per_ticket: rule.fixedKoboPerTicket };
}

export function calculatePlatformFee(
  rule: PlatformFeeRule,
  subtotalKobo: number,
  ticketQuantity: number,
) {
  if (
    !Number.isSafeInteger(subtotalKobo) ||
    subtotalKobo < 0 ||
    !Number.isSafeInteger(ticketQuantity) ||
    ticketQuantity < 0
  ) {
    throw new Error('The checkout totals are invalid.');
  }
  return rule.type === 'percentage'
    ? Math.round((subtotalKobo * rule.basisPoints) / 10000)
    : rule.fixedKoboPerTicket * ticketQuantity;
}
