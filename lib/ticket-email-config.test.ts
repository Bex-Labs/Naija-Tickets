import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ticketEmailConfigured,
  ticketEmailOrigin,
} from './ticket-email-config.ts';

void test('public email links can coexist with a local payment callback', () => {
  const config = {
    APP_URL: 'http://localhost:3000',
    EMAIL_APP_URL: 'https://naija-tickets.vercel.app',
    RESEND_API_KEY: 'test-only',
    EMAIL_FROM: 'onboarding@resend.dev',
  };
  assert.equal(ticketEmailOrigin(config), 'https://naija-tickets.vercel.app');
  assert.equal(ticketEmailConfigured(config), true);
  assert.equal(config.APP_URL, 'http://localhost:3000');
});

void test('existing production email configuration still uses APP_URL', () => {
  assert.equal(
    ticketEmailOrigin({ APP_URL: 'https://tickets.example.com/' }),
    'https://tickets.example.com',
  );
});

void test('email requires both the provider key and sender', () => {
  const base = {
    APP_URL: 'https://tickets.example.com',
    RESEND_API_KEY: 'test-only',
    EMAIL_FROM: 'tickets@example.com',
  };
  assert.equal(ticketEmailConfigured(base), true);
  assert.equal(ticketEmailConfigured({ ...base, RESEND_API_KEY: ' ' }), false);
  assert.equal(ticketEmailConfigured({ ...base, EMAIL_FROM: '' }), false);
});

void test('unusable email links are rejected instead of sent to customers', () => {
  for (const address of [
    '',
    'not a url',
    'http://tickets.example.com',
    'https://localhost:3000',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:pass@tickets.example.com',
  ]) {
    const config = {
      EMAIL_APP_URL: address,
      RESEND_API_KEY: 'test-only',
      EMAIL_FROM: 'tickets@example.com',
    };
    assert.equal(ticketEmailConfigured(config), false);
    assert.throws(() => ticketEmailOrigin(config), /email link address/);
  }
});
