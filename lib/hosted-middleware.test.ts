import assert from 'node:assert/strict';
import test from 'node:test';
import middleware from '../middleware.ts';
const id = '10000000-0000-4000-8000-000000000001',
  access = 'a'.repeat(64);
void test('hosted capability handoff works with a standard Web Request and strips its query', () => {
  const r = middleware(
    new Request(
      `https://sandbox.example/integrations/checkout/${id}?access=${access}&ignored=value`,
    ),
  );
  assert.equal(r.status, 303);
  assert.equal(
    r.headers.get('location'),
    `https://sandbox.example/integrations/checkout/${id}`,
  );
  const cookie = r.headers.get('set-cookie')!;
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('SameSite=Lax'));
  assert.ok(cookie.includes('Secure'));
  assert.ok(cookie.includes('Max-Age=1800'));
  assert.ok(cookie.includes(`Path=/integrations/checkout/${id}`));
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('x-middleware-next'), null);
});
void test('malformed capabilities and non-GET requests cannot create hosted cookies', () => {
  for (const [path, method] of [
    [`/integrations/checkout/${id}?access=invalid`, 'GET'],
    [`/integrations/checkout/${id}/other?access=${access}`, 'GET'],
    [`/integrations/checkout/${id}?access=${access}`, 'POST'],
  ]) {
    const r = middleware(
      new Request('https://sandbox.example' + path, { method }),
    );
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(r.headers.get('x-middleware-next'), '1');
    assert.ok(r.headers.get('cache-control')?.includes('no-store'));
  }
});
