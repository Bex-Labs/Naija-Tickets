import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCustomerProfileInput } from './customer-profile.ts';

void test('validates and normalizes permitted customer profile fields', () => {
  assert.deepEqual(
    parseCustomerProfileInput({
      fullName: '  Ada Okafor  ',
      phone: '  +234 801 234 5678 ',
      email: 'ignored@example.com',
    }),
    { value: { fullName: 'Ada Okafor', phone: '+234 801 234 5678' } },
  );
});

void test('requires a valid name and phone number', () => {
  assert.match(
    parseCustomerProfileInput({ fullName: 'A', phone: '1234567' }).error || '',
    /full name/,
  );
  assert.match(
    parseCustomerProfileInput({ fullName: 'Ada', phone: '123' }).error || '',
    /phone number/,
  );
  assert.ok(parseCustomerProfileInput(null).error);
});
