import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashVisitorId,
  isValidVisitorId,
  readVisitorId,
  shouldCountVisitor,
  visitorDay,
  visitorTrackingEnabled,
} from './site-visitors.ts';

void test('visitor identifiers are random UUIDs and stored as stable hashes', async () => {
  const visitor = '8fe67286-cf67-4d16-8c67-54d828004d09';
  assert.equal(isValidVisitorId(visitor), true);
  assert.equal(isValidVisitorId('someone@example.com'), false);
  assert.equal(isValidVisitorId(null), false);
  assert.equal(isValidVisitorId('8fe67286-cf67-1d16-8c67-54d828004d09'), false);
  const hash = await hashVisitorId(visitor);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashVisitorId(visitor.toUpperCase()), hash);
  assert.notEqual(
    await hashVisitorId('8fe67286-cf67-4d16-8c67-54d828004d10'),
    hash,
  );
});

void test('visitor dates switch at midnight in Nigeria', () => {
  assert.equal(visitorDay(new Date('2026-10-07T22:59:59Z')), '2026-10-07');
  assert.equal(visitorDay(new Date('2026-10-07T23:00:00Z')), '2026-10-08');
});

void test('public browsing counts while admin and organiser tools do not', () => {
  for (const path of [
    '/',
    '/events/show',
    '/checkout/show',
    '/account',
    '/signup',
    '/groups/invite',
  ]) {
    assert.equal(shouldCountVisitor(path), true, path);
  }
  for (const path of [
    '/admin',
    '/admin/settings',
    '/organiser',
    '/organiser/events',
    '/entry',
    '/entry/scan',
    '/api/visitors',
  ]) {
    assert.equal(shouldCountVisitor(path), false, path);
  }
});

void test('development and Vercel previews cannot inflate production visitors', () => {
  assert.equal(visitorTrackingEnabled('production', 'production'), true);
  assert.equal(visitorTrackingEnabled('production'), true);
  assert.equal(visitorTrackingEnabled('development'), false);
  assert.equal(visitorTrackingEnabled('production', 'preview'), false);
  assert.equal(visitorTrackingEnabled('production', 'development'), false);
});

void test('the recording payload accepts only a bounded JSON visitor identifier', async () => {
  const visitorId = '8fe67286-cf67-4d16-8c67-54d828004d09';
  const request = (body: string, contentType = 'application/json') =>
    new Request('https://tickets.example.com/api/visitors', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
  assert.equal(
    await readVisitorId(request(JSON.stringify({ visitorId }))),
    visitorId,
  );
  assert.equal(await readVisitorId(request('not JSON')), null);
  assert.equal(await readVisitorId(request('{}')), null);
  assert.equal(
    await readVisitorId(
      request(JSON.stringify({ visitorId: 'email@example.com' })),
    ),
    null,
  );
  assert.equal(
    await readVisitorId(request(JSON.stringify({ visitorId }), 'text/plain')),
    null,
  );
  assert.equal(
    await readVisitorId(
      request(JSON.stringify({ visitorId, oversized: 'a'.repeat(300) })),
    ),
    null,
  );
});
