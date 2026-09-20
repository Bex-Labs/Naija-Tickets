import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (name: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );

export async function createPromoTestDatabase() {
  const db = new PGlite();
  // Supabase auth and pgcrypto adapters for the embedded PostgreSQL test runtime.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create schema extensions;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$
      select substring(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex') from 1 for n)
    $$;
    create function extensions.digest(value text, algorithm text) returns bytea language sql as $$
      select sha256(convert_to(value, 'UTF8'))
    $$;
  `);
  await db.exec(
    migration('202609120001_initial_schema.sql').replace(
      'create extension if not exists pgcrypto;',
      '',
    ),
  );
  await db.exec(migration('202609150001_paystack_payments.sql'));
  const earlyBird = migration('202609170002_early_bird_ticket_pricing.sql');
  await db.exec(
    earlyBird.slice(
      0,
      earlyBird.indexOf('create function public.save_organiser_event_v2'),
    ),
  );
  const reservationStart = earlyBird.indexOf(
    'create or replace function public.create_checkout_reservation_v2',
  );
  await db.exec(
    earlyBird.slice(
      reservationStart,
      earlyBird.indexOf(
        'comment on function public.save_organiser_event_v2',
        reservationStart,
      ),
    ),
  );
  await db.exec(migration('202609200001_promo_codes.sql'));
  return db;
}
