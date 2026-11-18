import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIntegrationStatus } from './integrations/validation.ts';
void test('status-only requests reject removal, ownership changes and malformed input', () => {
  assert.equal(parseIntegrationStatus({ status: 'disabled' }), 'disabled');
  assert.equal(parseIntegrationStatus({ status: 'active' }), 'active');
  for (const value of [
    null,
    [],
    {},
    { status: ['active'] },
    { status: 'removed' },
    { action: 'remove' },
    { status: 'active', organiserId: 'foreign' },
  ])
    assert.throws(() => parseIntegrationStatus(value), /active or disabled/);
});
