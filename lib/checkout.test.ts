import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculatePlatformFee,
  DEFAULT_PLATFORM_FEE_RULE,
  parsePlatformFeeRule,
  platformFeeRuleFromAdminInput,
  platformFeeStorageValue,
} from './platform-fee.ts';

void test('defaults safely to the current five percent fee', () => {
  assert.deepEqual(parsePlatformFeeRule(null), DEFAULT_PLATFORM_FEE_RULE);
  assert.deepEqual(parsePlatformFeeRule({ type: 'unknown' }), {
    type: 'percentage',
    basisPoints: 500,
  });
  assert.equal(
    calculatePlatformFee(DEFAULT_PLATFORM_FEE_RULE, 1_000_000, 2),
    50_000,
  );
});

void test('calculates percentage fees from subtotal in basis points', () => {
  const rule = parsePlatformFeeRule({
    type: 'percentage',
    basis_points: 725,
  });
  assert.deepEqual(rule, { type: 'percentage', basisPoints: 725 });
  assert.equal(calculatePlatformFee(rule, 2_500_000, 3), 181_250);
  assert.deepEqual(platformFeeStorageValue(rule), {
    type: 'percentage',
    basis_points: 725,
  });
});

void test('calculates fixed fees once for every purchased ticket', () => {
  const rule = parsePlatformFeeRule({
    type: 'fixed',
    fixed_kobo_per_ticket: 150_000,
  });
  assert.deepEqual(rule, { type: 'fixed', fixedKoboPerTicket: 150_000 });
  assert.equal(calculatePlatformFee(rule, 0, 4), 600_000);
  assert.deepEqual(platformFeeStorageValue(rule), {
    type: 'fixed',
    fixed_kobo_per_ticket: 150_000,
  });
});

void test('accepts precise admin values and rejects empty or over-precise input', () => {
  assert.deepEqual(
    platformFeeRuleFromAdminInput({ type: 'percentage', percentage: '7.25' }),
    { type: 'percentage', basisPoints: 725 },
  );
  assert.deepEqual(
    platformFeeRuleFromAdminInput({
      type: 'fixed',
      fixedNairaPerTicket: '1500.50',
    }),
    { type: 'fixed', fixedKoboPerTicket: 150_050 },
  );
  assert.equal(
    platformFeeRuleFromAdminInput({ type: 'percentage', percentage: '' }),
    null,
  );
  assert.equal(
    platformFeeRuleFromAdminInput({
      type: 'fixed',
      fixedNairaPerTicket: '2.555',
    }),
    null,
  );
});
