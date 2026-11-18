import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrationSetupPath,
  restoredIntegrationSelection,
  integrationSelectionKey,
} from './integrations/setup-preference.ts';
import { parseIntegrationApplication } from './integrations/validation.ts';
import type { IntegrationApplication } from './integrations/types.ts';
const app = {
  id: '10000000-0000-4000-8000-000000000001',
  organiserId: '20000000-0000-4000-8000-000000000001',
  name: 'My developer site',
  setupPath: 'api',
  status: 'active',
  domains: [],
  eventIds: [],
  keys: [],
} as unknown as IntegrationApplication;
void test('saved API setup restores with the correct connection after refresh', () => {
  assert.equal(
    integrationSetupPath(restoredIntegrationSelection([app], app.id)),
    'api',
  );
  assert.equal(restoredIntegrationSelection([app], null)?.id, app.id);
  const newer = { ...app, id: 'newer', createdAt: '2026-11-13T00:00:00Z' };
  assert.equal(
    restoredIntegrationSelection(
      [{ ...app, createdAt: '2026-11-12T00:00:00Z' }, newer],
      null,
    )?.id,
    'newer',
  );
  assert.equal(restoredIntegrationSelection([app], ''), undefined);
  assert.equal(restoredIntegrationSelection([], app.id), undefined);
  assert.notEqual(
    integrationSelectionKey('account-a'),
    integrationSelectionKey('account-b'),
  );
});
void test('setup path validation preserves legacy callers and rejects unsupported choices', () => {
  const body = {
    organiserId: app.organiserId,
    name: app.name,
    setupPath: 'api',
  };
  assert.equal(parseIntegrationApplication(body).setupPath, 'api');
  assert.equal(
    parseIntegrationApplication({ ...body, setupPath: undefined }).setupPath,
    undefined,
  );
  assert.throws(() =>
    parseIntegrationApplication({ ...body, setupPath: 'script' }),
  );
});
