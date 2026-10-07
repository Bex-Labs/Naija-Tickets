import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { AdminVisitorAnalytics } from './site-visitors.ts';

void test('visitor totals deduplicate browsers, use Lagos dates and remain private', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202610070001_admin_visitor_analytics.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const totals = async () => {
      const { rows } = await db.query<{ analytics: AdminVisitorAnalytics }>(
        'select public.admin_visitor_analytics() as analytics',
      );
      return rows[0].analytics;
    };
    await t.test(
      'an empty installation starts at zero without invented history',
      async () => {
        assert.deepEqual(await totals(), {
          totalVisitors: 0,
          visitorsToday: 0,
          visitorsLast30Days: 0,
          trackingStartedAt: null,
        });
      },
    );
    await t.test(
      'repeated and concurrent visits update a single browser record',
      async () => {
        await Promise.all(
          Array.from({ length: 5 }, () =>
            db.query('select public.record_site_visitor($1)', ['a'.repeat(64)]),
          ),
        );
        const stats = await totals();
        assert.equal(stats.totalVisitors, 1);
        assert.equal(stats.visitorsToday, 1);
        assert.equal(stats.visitorsLast30Days, 1);
        assert.ok(stats.trackingStartedAt);
        assert.ok(!JSON.stringify(stats).includes('a'.repeat(64)));
      },
    );
    await t.test('today and the 30-day boundary use midnight WAT', async () => {
      await db.exec(`
        insert into public.site_visitors(visitor_hash,first_seen_at,last_seen_at)
        select repeat('b',64), today_start-interval '1 second', today_start-interval '1 second'
        from (select date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' as today_start) b;
        insert into public.site_visitors(visitor_hash,first_seen_at,last_seen_at)
        select repeat('c',64), today_start-interval '29 days', today_start-interval '29 days'
        from (select date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' as today_start) b;
        insert into public.site_visitors(visitor_hash,first_seen_at,last_seen_at)
        select repeat('d',64), today_start-interval '29 days 1 second', today_start-interval '29 days 1 second'
        from (select date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' as today_start) b;
      `);
      const stats = await totals();
      assert.equal(stats.totalVisitors, 4);
      assert.equal(stats.visitorsToday, 1);
      assert.equal(stats.visitorsLast30Days, 3);
      await db.query('select public.record_site_visitor($1)', ['d'.repeat(64)]);
      const returned = await totals();
      assert.equal(returned.totalVisitors, 4);
      assert.equal(returned.visitorsToday, 2);
      assert.equal(returned.visitorsLast30Days, 4);
      assert.equal(returned.trackingStartedAt, stats.trackingStartedAt);
    });
    await t.test('invalid identifiers cannot create records', async () => {
      await assert.rejects(
        db.query('select public.record_site_visitor($1)', [
          'email@example.com',
        ]),
        /Invalid visitor/,
      );
      await assert.rejects(
        db.query('select public.record_site_visitor(null)'),
        /Invalid visitor/,
      );
      assert.equal((await totals()).totalVisitors, 4);
    });
    await t.test(
      'only the service role can record visits or read aggregate totals',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          await db.exec(`set role ${role}`);
          await assert.rejects(
            db.query('select * from public.site_visitors'),
            /permission denied/,
          );
          await assert.rejects(
            db.query('select public.admin_visitor_analytics()'),
            /permission denied/,
          );
          await assert.rejects(
            db.query('select public.record_site_visitor($1)', ['e'.repeat(64)]),
            /permission denied/,
          );
          await db.exec('reset role');
        }
        await db.exec('set role service_role');
        await db.query('select public.record_site_visitor($1)', [
          'e'.repeat(64),
        ]);
        assert.equal((await totals()).totalVisitors, 5);
        await db.exec('reset role');
        const { rows } = await db.query<{ enabled: boolean }>(
          "select relrowsecurity as enabled from pg_class where oid='public.site_visitors'::regclass",
        );
        assert.equal(rows[0].enabled, true);
      },
    );
  } finally {
    await db.close();
  }
});
