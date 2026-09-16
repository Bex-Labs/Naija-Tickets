import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { categories, cities, featuredCities, stateForCity } from './events.ts';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/202609160001_organiser_profiles_and_catalogue.sql',
    import.meta.url,
  ),
  'utf8',
);

void test('provides twenty filter cities while keeping six featured cities', () => {
  assert.equal(cities.length, 20);
  assert.equal(featuredCities.length, 6);
  assert.ok(featuredCities.every((city) => cities.includes(city)));
  assert.equal(stateForCity('Port Harcourt'), 'Rivers');
  assert.equal(stateForCity('Abuja'), 'FCT');
});

void test('includes the expanded category catalogue', () => {
  for (const category of [
    'Spirituality & religion',
    'Community',
    'Food & drinks',
    'Book clubs',
  ]) {
    assert.ok(categories.includes(category));
    assert.match(migration, new RegExp(category.replace('&', '\\&'), 'i'));
  }
});

void test('migration stores organiser type and public social links', () => {
  assert.match(migration, /account_type/);
  assert.match(migration, /website_url/);
  assert.match(migration, /instagram_url/);
  assert.match(migration, /x_url/);
  assert.match(migration, /facebook_url/);
  assert.match(migration, /tiktok_url/);
});
