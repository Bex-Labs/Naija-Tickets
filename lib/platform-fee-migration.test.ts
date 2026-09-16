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

void test('checkout fees come only from the database-owned setting', () => {
  assert.match(migration, /from public\.platform_settings/);
  assert.match(migration, /where setting\.key = 'platform_fee'/);
  assert.match(
    migration,
    /revoke execute on function public\.create_checkout_reservation\([\s\S]*from service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.create_checkout_reservation_v2/,
  );
});

void test('fixed fees use quantity while percentage fees use subtotal', () => {
  assert.match(migration, /fixed_kobo_per_ticket::bigint \* ticket_quantity/);
  assert.match(
    migration,
    /created_order\.subtotal_kobo \* basis_points \/ 10000\.0/,
  );
  assert.match(migration, /fee_kobo = calculated_fee/);
  assert.match(
    migration,
    /total_kobo = created_order\.subtotal_kobo \+ calculated_fee/,
  );
});
