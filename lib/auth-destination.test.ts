import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountHomeFromMetadata,
  authenticatedDestination,
} from './auth-destination.ts';

void test('customer login opens the account dashboard by default', () => {
  assert.equal(authenticatedDestination(null), '/account');
  assert.equal(authenticatedDestination('/account'), '/account');
});

void test('login preserves supported checkout and organiser destinations', () => {
  assert.equal(
    authenticatedDestination('/checkout/live-show?selection=0%3A2'),
    '/checkout/live-show?selection=0%3A2',
  );
  assert.equal(authenticatedDestination('/organiser'), '/organiser');
  assert.equal(authenticatedDestination('https://example.com'), '/account');
  assert.equal(authenticatedDestination('//example.com'), '/account');
});

void test('account metadata keeps customer and organiser dashboards separate', () => {
  assert.equal(
    accountHomeFromMetadata({ account_purpose: 'customer' }),
    '/account',
  );
  assert.equal(
    accountHomeFromMetadata({ account_purpose: 'organiser' }),
    '/organiser',
  );
  assert.equal(
    accountHomeFromMetadata({ account_type: 'individual' }),
    '/organiser',
  );
  assert.equal(authenticatedDestination(null, '/organiser'), '/organiser');
});
