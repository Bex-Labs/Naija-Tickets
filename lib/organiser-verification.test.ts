import assert from 'node:assert/strict';
import test from 'node:test';
import {
  organiserFacingReference,
  validIdentityReference,
} from './organiser-verification.ts';

void test('individual verification accepts exactly an 11-digit NIN and masks it on return', () => {
  assert.equal(validIdentityReference('individual', '12345678901'), true);
  assert.equal(validIdentityReference('individual', '1234567890'), false);
  assert.equal(validIdentityReference('individual', '1234567890a'), false);
  assert.deepEqual(organiserFacingReference('individual', '12345678901'), {
    registrationReference: '',
    referenceLast4: '8901',
  });
});

void test('organisation verification accepts CAC registration numbers', () => {
  assert.equal(validIdentityReference('organisation', 'RC 1234567'), true);
  assert.equal(validIdentityReference('organisation', 'BN-1234567'), true);
  assert.equal(validIdentityReference('organisation', 'RC@123'), false);
  assert.deepEqual(organiserFacingReference('organisation', 'RC 1234567'), {
    registrationReference: 'RC 1234567',
    referenceLast4: '',
  });
});
