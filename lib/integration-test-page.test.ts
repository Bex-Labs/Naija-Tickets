import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedLinkTestPage } from './integrations/test-page.ts';

test('downloaded test page accepts only public hosted links and makes no payment claim', () => {
  const path = '/checkout/link/nt_link_' + 'a'.repeat(32);
  for (const origin of ['https://sandbox.example', 'http://localhost:3002']) {
    const page = hostedLinkTestPage(origin + path);
    assert.ok(page.includes('href="' + origin + path + '"'));
    assert.ok(page.includes('Returning here alone does not confirm'));
    assert.ok(!page.includes('<script'));
  }
  for (const value of [
    'javascript:alert(1)',
    'http://remote.example' + path,
    'https://user:secret@sandbox.example' + path,
    'https://sandbox.example/integrations/checkout/123?access=secret',
    'https://sandbox.example' + path + '?key=secret',
    'https://sandbox.example' + path + '#fragment',
  ])
    assert.throws(() => hostedLinkTestPage(value));
});
