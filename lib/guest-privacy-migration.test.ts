import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/202609150004_guest_privacy_and_ticket_email.sql',
    import.meta.url,
  ),
  'utf8',
);

void test('guest erasure anonymizes every known purchaser and attendee PII surface', () => {
  assert.match(migration, /update public\.orders/);
  assert.match(migration, /update public\.order_items/);
  assert.match(migration, /update public\.tickets/);
  assert.match(migration, /update public\.payments/);
  assert.match(migration, /update public\.ticket_deliveries/);
  assert.match(migration, /admin\.guest_personal_data_erased/);
});

void test('guest erasure preserves financial and ticket records', () => {
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+public\.(orders|order_items|payments|tickets|ticket_deliveries)/i,
  );
  assert.match(migration, /'ticket_codes_retained', true/);
  assert.match(migration, /'financial_records_retained', true/);
});
