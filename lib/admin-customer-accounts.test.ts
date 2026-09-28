import assert from 'node:assert/strict';
import test from 'node:test';
import { isCustomerAccount } from './admin-customer-accounts.ts';

void test('signed-up customers remain visible despite an older organiser membership', () => {
  assert.equal(
    isCustomerAccount({ user_metadata: { account_purpose: 'customer' } }, true),
    true,
  );
});

void test('organiser signup is not listed as a customer before the first event', () => {
  assert.equal(
    isCustomerAccount(
      { user_metadata: { account_purpose: 'organiser' } },
      false,
    ),
    false,
  );
});

void test('legacy registered buyers are included but deleted and anonymous accounts are excluded', () => {
  assert.equal(isCustomerAccount({}, false), true);
  assert.equal(isCustomerAccount({}, true), false);
  assert.equal(isCustomerAccount({ is_anonymous: true }, false), false);
  assert.equal(isCustomerAccount({ deleted_at: '2026-09-28' }, false), false);
});
